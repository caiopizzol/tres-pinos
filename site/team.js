// The team in the hero: two agents closing a month in a group chat. The numbers are the fictional September that the
// conciliar-extrato test serves (skills/conciliar-extrato/test/month.mjs). With reduced motion it shows the end.
const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;

const AGENTS = {
  financeiro: { name: "Financeiro", tools: ["sicoob", "inter", "ler-conta"] },
  fiscal: { name: "Fiscal", tools: ["nfse", "conciliar-extrato"] },
  contabil: { name: "Contábil", vaga: true },
  juridico: { name: "Jurídico", vaga: true },
};
// What the test expects: six credits, 50 + 7 documents, one suggestion and five entries without one.
const CREDITS = 6;
const BATCHES = [50, 7];
const UNMATCHED = [
  ["R$ 3.000,00", "duas notas com esse valor"],
  ["R$ 800,00", "a nota foi cancelada"],
  ["R$ 500,00", "nota de outra empresa"],
  ["R$ 2.000,00", "nota de mais de 120 dias antes"],
  ["R$ 120,00", "nenhuma nota com esse valor"],
];

// The socket from assets/mark.svg as a face: "idle" is the outline, "working" lights it with its eyes moving, "on"
// lights it still, and "vaga" is a dashed slot.
function face(state) {
  return `<svg class="face" data-state="${state}" viewBox="0 0 128 128" aria-hidden="true">
    <polygon class="plate" points="44,32 84,32 104,64 84,96 44,96 24,64"/>
    <circle class="eye" cx="43" cy="58" r="9"/><circle class="eye" cx="85" cy="58" r="9"/>
    <circle class="mouth" cx="64" cy="75" r="9"/>
  </svg>`;
}
const avatar = (id, status) =>
  `<span class="avatar">${face(AGENTS[id].vaga ? "vaga" : "idle")}${
    status === undefined ? "" : `<i class="status" data-s="${status}"></i>`
  }</span>`;

function h(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

const app = document.getElementById("app");
const roster = document.getElementById("roster");
const log = document.getElementById("log");
const handoff = document.getElementById("handoff");

roster.innerHTML = `<p>Equipe</p>
  ${Object.entries(AGENTS)
    .map(
      ([id, a]) => `<div class="member ${a.vaga ? "vaga" : ""}" data-id="${id}">
        ${avatar(id, a.vaga ? undefined : "idle")}
        <span><b>${a.name}</b><small id="line-${id}">${a.vaga ? "vaga aberta" : a.tools.join(" · ")}</small></span>
      </div>`,
    )
    .join("")}
  <p>Grupos</p>
  <div class="group"><div class="stack">${avatar("financeiro")}${avatar("fiscal")}</div>
    <span><b>Fechamento</b><small>2 agentes</small></span></div>`;
document.getElementById("group-stack").innerHTML = avatar("financeiro") + avatar("fiscal");

function setState(id, state, line) {
  const member = roster.querySelector(`[data-id="${id}"]`);
  member.querySelector(".face").dataset.state =
    state === "idle" ? "idle" : state === "working" ? "working" : "on";
  member.querySelector(".status").dataset.s = state;
  if (line !== undefined) document.getElementById(`line-${id}`).textContent = line;
}
const follow = () =>
  log.scrollTo({ top: log.scrollHeight, behavior: instant ? "instant" : "smooth" });
function say(id, html) {
  const node = h(`<div class="msg fade-in">${avatar(id)}<div>
    <div class="who"><b>${AGENTS[id].name}</b></div><div class="bubble">${html}</div></div></div>`);
  node.querySelector(".face").dataset.state = "on";
  log.append(node);
  follow();
  return node;
}
function you(text) {
  const node = h(`<div class="you fade-in"></div>`);
  node.textContent = text;
  log.append(node);
  follow();
  return node;
}
function showHandoff(id, text) {
  handoff.innerHTML = text ? `${avatar(id)}<span>${text}</span>` : "";
  if (text) handoff.querySelector(".face").dataset.state = "working";
}

// One scene at a time: playing again cancels the one in progress at its next wait.
const STOP = Symbol("stop");
let generation = 0;
async function play() {
  const mine = ++generation;
  const wait = (ms) =>
    new Promise((resolve, reject) =>
      setTimeout(() => (generation === mine ? resolve() : reject(STOP)), instant ? 0 : ms),
    );
  try {
    await scene(wait);
  } catch (error) {
    if (error !== STOP) throw error;
  }
}

async function scene(wait) {
  log.innerHTML = "";
  showHandoff();
  for (const id of ["financeiro", "fiscal"]) setState(id, "idle", AGENTS[id].tools.join(" · "));

  const ask = "Fecha setembro: o que entrou e o que ficou sem nota?";
  const question = you(instant ? ask : "");
  for (let i = 1; !instant && i <= ask.length; i++) {
    question.textContent = ask.slice(0, i);
    await wait(16);
  }
  await wait(500);

  setState("financeiro", "working", "lendo o extrato…");
  showHandoff("financeiro", "Financeiro está lendo o Inter…");
  const f = say(
    "financeiro",
    `<div class="tool"><span class="spin"></span>inter · get_statement 2026-09</div>`,
  );
  await wait(1400);
  f.querySelector(".tool").innerHTML = `<span class="check">✓</span> inter · get_statement 2026-09`;
  f.querySelector(".bubble").append(
    h(`<div>${CREDITS} entradas em setembro. Passando para o Fiscal.</div>`),
  );
  follow();
  setState("financeiro", "on", `${CREDITS} entradas lidas`);
  await wait(900);

  setState("fiscal", "working", "lendo as notas…");
  showHandoff("fiscal", "Fiscal está lendo as NFS-e…");
  const n = say("fiscal", `<div class="tool"><span class="spin"></span>nfse · list_invoices</div>`);
  await wait(900);
  n.querySelector(".tool").innerHTML = `<span class="spin"></span>nfse · list_invoices · lote 2`;
  await wait(900);
  n.querySelector(".tool").innerHTML =
    `<span class="check">✓</span> nfse · list_invoices · ${BATCHES.join(" + ")} documentos`;
  showHandoff("fiscal", "Fiscal está conciliando…");
  await wait(900);

  const rows = UNMATCHED.map(
    ([value, why]) => `<div><span class="n">${value}</span><span class="why">${why}</span></div>`,
  ).join("");
  n.querySelector(".bubble").append(
    h(`<div><div class="lines">${UNMATCHED.length} entradas ficam sem sugestão:</div>
      <div class="found">${rows}</div>
      <div class="lines">R$ 1.450,50 de 05/09 parece ser a <b>nota nº 1</b>, de Fulano &amp; Filhos. Confirma?</div>
      <div class="answers"><button type="button" class="chipbtn go" data-answer="yes">É essa</button><button type="button" class="chipbtn" data-answer="no">Não é</button></div></div>`),
  );
  setState("fiscal", "waiting", "esperando você");
  showHandoff();
  follow();
}

log.addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer]");
  if (!button) return;
  button.parentElement.remove();
  you(button.textContent);
  say(
    "fiscal",
    button.dataset.answer === "yes"
      ? "Certo, nota nº 1. As outras cinco ficam sem sugestão."
      : "Certo, fica sem sugestão, como as outras cinco.",
  );
  setState("fiscal", "on", "setembro conferido");
});
document.getElementById("replay").addEventListener("click", play);

// Plays the first time the window scrolls into view.
new IntersectionObserver((entries, observer) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  observer.disconnect();
  play();
}).observe(app);
