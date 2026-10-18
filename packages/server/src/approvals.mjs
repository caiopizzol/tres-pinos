// Approvals the owner gives outside the agent, for work with legal or financial effect. A tool asks for one with what
// the work will do; the owner reads it on /approve/<id> and approves it by typing the approval key, which runs the
// work there, once, and shows its result. The agent learns what came of it with status(). The server keeps only the
// key's SHA-256, so an agent that can read the settings still can't approve. Approvals live in memory and expire, so
// a restart drops them and the owner approves again.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { escape, page, read, send, style } from "./page.mjs";

// How long a request waits for the owner, and how long what came of it stays readable after they decide.
const TTL_MS = 60 * 60_000;
// Wrong keys before the request is dropped, so the agent, which knows the link, can't keep guessing.
const MAX_WRONG = 5;
// Each request holds its work in memory, so a loop of them replaces the oldest. Only requests the agent can make on
// its own count: undecided ones, and refused ones, since refusing needs no key. What the owner approved, running or
// settled, stays its hour, and only the owner's key adds to it.
const MAX_OPEN = 100;

// Why a tool can't go on: its message is for the agent.
export class ApprovalError extends Error {}

// `name` is the hash's setting, such as NFSE_APPROVAL_HASH. `url` is where the owner opens the server, set by the
// owner, never taken from a request: an agent could otherwise point the link at a page of its own and read the key.
export function createApprovals({ name, hash, url, now = () => Date.now() }) {
  if (!/^[0-9a-f]{64}$/.test(hash ?? ""))
    throw new Error(`${name} must be the SHA-256 of the approval key, in hex`);
  if (!URL.canParse(url ?? ""))
    throw new Error("Approvals need the address the owner opens them at");
  // The owner types the key there, so it must not cross a network in the clear.
  const { protocol, hostname } = new URL(url);
  if (protocol !== "https:" && !["127.0.0.1", "localhost"].includes(hostname))
    throw new Error("Approvals need an https address, or 127.0.0.1 on this machine");
  const expected = Buffer.from(hash, "hex");
  // The key is 32 random bytes or more, so a short one is never the owner's, whatever its hash.
  const isOwner = (given) =>
    (given ?? "").length >= 32 &&
    timingSafeEqual(
      createHash("sha256")
        .update(given ?? "")
        .digest(),
      expected,
    );
  const origin = new URL(url).origin;
  const approvals = new Map();

  // Asks the owner to approve `run`, the work, described by `title` and `summary` ([label, value] pairs), with
  // `button` saying what approving does, such as "Aprovar e pagar". Approving calls `run` once. `report` turns its
  // result into [label, value] pairs for the page, and `describe` says what the owner and the agent may see of a
  // failure, as for toolAnswer. Returns the approval's id and the link to it.
  function request({ title, summary, button, run, report, describe }) {
    for (const [id, entry] of approvals) if (entry.expiresAt <= now()) approvals.delete(id);
    const open = [...approvals.keys()].filter((id) =>
      ["pending", "refused"].includes(approvals.get(id).status),
    );
    for (const id of open.slice(0, Math.max(0, open.length + 1 - MAX_OPEN))) approvals.delete(id);
    const id = randomBytes(24).toString("base64url");
    approvals.set(id, {
      title,
      summary,
      button,
      run,
      report,
      describe,
      status: "pending",
      wrong: 0,
      expiresAt: now() + TTL_MS,
    });
    return { approval: id, link: `${origin}/approve/${id}` };
  }

  // What came of an approval, for the agent: pending, refused, running, done with the result, or failed with what
  // `describe` says about the error.
  function status(id) {
    const entry = approvals.get(id);
    if (!entry || entry.expiresAt <= now())
      throw new ApprovalError("No approval with this id: it expired or never existed");
    return { status: entry.status, result: entry.result, error: entry.error };
  }

  const rows = (pairs) =>
    `<dl>${pairs
      .map(
        ([label, value]) =>
          `<dt style="color:#6A675F;font-size:.9rem">${escape(label)}</dt><dd style="margin:0 0 .75rem">${escape(value)}</dd>`,
      )
      .join("")}</dl>`;

  // The request, while the owner hasn't decided, with the key to approve it or a way to refuse it.
  function form(res, id, entry, wrong = false) {
    page(
      res,
      wrong ? 401 : 200,
      `<h1 style="font-size:1.25rem">${escape(entry.title)}</h1>${rows(entry.summary)}
<form method="post" action="/approve/${id}">
<label>Chave de aprovação<input name="key" type="password" required autocomplete="current-password" style="${style.field}"></label>
${wrong ? '<p style="color:#B42318">Chave errada.</p>' : ""}
<button name="decision" value="approve" style="${style.button};background:#1D1D1F;color:#F7C831">${escape(entry.button)}</button>
<button name="decision" value="refuse" formnovalidate style="${style.button};background:none">Recusar</button>
</form>`,
    );
  }

  // What came of it, once the owner decided.
  function outcome(res, entry) {
    if (entry.status === "done")
      return page(
        res,
        200,
        `<h1 style="font-size:1.25rem">Feito</h1>${rows(entry.report(entry.result))}`,
      );
    if (entry.status === "failed")
      return page(
        res,
        200,
        `<h1 style="font-size:1.25rem">Não deu certo</h1><p>${escape(entry.error)}</p>
<p>Peça ao agente para conferir o que aconteceu antes de tentar de novo.</p>`,
      );
    page(
      res,
      200,
      entry.status === "refused"
        ? "<p>Recusado. Nada foi feito.</p>"
        : "<p>Em andamento. Recarregue a página em instantes.</p>",
    );
  }

  // Answers /approve/<id>, and returns false for anything else. Refusing needs no key: it only ever stops the work.
  async function handle(req, res) {
    const id = /^\/approve\/([\w-]+)$/.exec(new URL(req.url, "http://x").pathname)?.[1];
    if (!id) return false;
    const live = (entry) => entry && approvals.get(id) === entry && entry.expiresAt > now();
    const gone = () =>
      page(res, 404, "<p>Este pedido não existe mais: expirou ou foi substituído.</p>");
    const entry = approvals.get(id);
    if (!live(entry)) return (gone(), true);
    if (req.method === "GET")
      return (entry.status === "pending" ? form(res, id, entry) : outcome(res, entry), true);
    if (req.method !== "POST") return (send(res, 405, ""), true);
    if (req.headers.origin !== origin) return (send(res, 403, "Origem errada."), true);
    const given = new URLSearchParams(await read(req));
    // The request may have changed while the form was read: decided, replaced or expired.
    if (!live(entry)) return (gone(), true);
    if (entry.status !== "pending") return (outcome(res, entry), true);
    if (given.get("decision") !== "approve") {
      entry.status = "refused";
      entry.expiresAt = now() + TTL_MS;
      return (outcome(res, entry), true);
    }
    if (!isOwner(given.get("key"))) {
      if (++entry.wrong < MAX_WRONG) return (form(res, id, entry, true), true);
      approvals.delete(id);
      page(res, 401, "<p>Chave errada muitas vezes. Peça ao agente um novo pedido.</p>");
      return true;
    }
    // Running from here on, with no await since the check above, so a second approval of the same request can't
    // start the work again. Running work doesn't expire: what comes of it stays for an hour after it ends.
    entry.status = "running";
    entry.expiresAt = Infinity;
    try {
      entry.result = await entry.run();
      entry.status = "done";
    } catch (error) {
      entry.error = entry.describe(error) ?? "unavailable";
      entry.status = "failed";
    }
    entry.expiresAt = now() + TTL_MS;
    outcome(res, entry);
    return true;
  }

  return { request, status, handle };
}
