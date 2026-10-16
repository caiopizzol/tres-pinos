// Paying boletos through the tools, against a fake Sicoob that, like the real one, accepts only a client certificate
// signed by its CA and keeps each payment under its idempotency key. Names, numbers and the boleto are fictional.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { certificateFetch } from "@tres-pinos/api";
import { createApprovals } from "@tres-pinos/server";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { guard } from "../src/guard.mjs";
import { API_URL, sicoobClient, TOKEN_URL } from "../src/sicoob.mjs";
import { buildServer } from "../src/tools.mjs";

const certs = certificates({ server: "/CN=localhost", owner: "/CN=FULANO DE TAL:00000000000" });

const LINE = "75691234536789012345767890123457715860000026500";
const BARCODE = "75697158600000265001234567890123456789012345";
const BILL = {
  codigoBarras: BARCODE,
  nomeRazaoSocialBeneficiario: "LOJA EXEMPLO LTDA",
  valorBoleto: 265,
  valorAbatimentoDesconto: 0,
  valorMultaMora: 3.5,
  valorPagamento: 268.5,
  dataVencimentoBoleto: "2026-10-25",
  bloquearPagamento: false,
  identificadorConsulta: "consulta-1",
};

// Sicoob's payments, by idempotency key, how the next payment ends, how it answers a key with no payment, and
// changes to the boleto it looks up.
let payments;
let outcome;
let absence;
let bill;
let start;
beforeEach(() => {
  payments = new Map();
  outcome = "Agendado";
  absence = 400;
  bill = {};
  start = requests.length;
});
const fake = fakeApi(certs, ({ method, path, body, headers }) => {
  const url = new URL(path, "https://x");
  if (path === "/token")
    return [200, { access_token: "t", scope: new URLSearchParams(body).get("scope") }];
  const receipt = /^\/pagamentos\/v3\/boletos\/pagamentos\/(.+)\/idempotency\/comprovantes$/.exec(
    url.pathname,
  );
  if (receipt) {
    const paid = payments.get(receipt[1]);
    if (paid) return [200, { resultado: paid }];
    return absence === 204
      ? [204, ""]
      : [400, { mensagens: [{ codigo: "10275", mensagem: "Comprovante não encontrado" }] }];
  }
  if (method === "GET" && url.pathname === `/pagamentos/v3/boletos/${BARCODE}`) {
    // Like Sicoob, a Sunday moves to Monday.
    const date = url.searchParams.get("dataPagamento");
    return [
      200,
      {
        resultado: {
          ...BILL,
          dataPagamento: date === "2026-10-25" ? "2026-10-26" : date,
          ...bill,
        },
      },
    ];
  }
  if (method === "POST" && url.pathname === `/pagamentos/v3/boletos/pagamentos/${BARCODE}`) {
    const sent = JSON.parse(body);
    const key = headers["x-idempotency-key"];
    // Like Sicoob, a key that already paid answers with that payment instead of paying again.
    const earlier = payments.get(key);
    if (earlier) return [200, { resultado: earlier }];
    const paid = {
      idPagamento: 1000 + payments.size,
      situacaoPagamento: outcome,
      dataPagamento: sent.date,
    };
    payments.set(key, paid);
    return [200, { resultado: paid }];
  }
  return [404, {}];
});
const { requests } = fake;
// The payments this test sent.
const paid = () => requests.slice(start).filter((r) => r.method === "POST" && r.path !== "/token");

function client() {
  const real = certificateFetch({ ...certs.identity("owner"), ca: certs.read("ca.crt") });
  return (url, init) =>
    real(url.replace(TOKEN_URL, `${fake.url()}/token`).replace(API_URL, fake.url()), init);
}
const config = {
  clientId: "client-id",
  account: "1234567",
  payer: { name: "FULANO DE TAL", cpf: "00000000000", cooperative: "3031" },
};

const APPROVAL_KEY = "a".repeat(32);
const approvals = () =>
  createApprovals({
    name: "SICOOB_APPROVAL_HASH",
    hash: createHash("sha256").update(APPROVAL_KEY).digest("hex"),
    url: "https://sicoob.example.com",
  });

async function connect(gate) {
  const server = buildServer(sicoobClient(config, guard(client(), { pay: true })), undefined, gate);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const agent = new Client({ name: "test", version: "0" });
  await agent.connect(clientSide);
  return agent;
}
const call = (agent, name, args) => agent.callTool({ name, arguments: args });
const result = (answer) => JSON.parse(answer.content[0].text);

// The owner's browser on the approval page: what it shows, and the form post it sends.
async function page(gate, link, form) {
  const url = new URL(link);
  const req = Object.assign(form ? [new URLSearchParams(form).toString()] : [], {
    url: url.pathname,
    method: form ? "POST" : "GET",
    headers: { origin: url.origin, host: url.host },
  });
  let html = "";
  const res = { writeHead: () => res, end: (body) => (html = String(body ?? "")) };
  assert.ok(await gate.handle(req, res));
  return html;
}
const approve = (gate, link) => page(gate, link, { key: APPROVAL_KEY, decision: "approve" });

test("the payment tools appear only with the owner's approvals", async () => {
  const readOnly = await connect(null);
  assert.deepEqual(
    (await readOnly.listTools()).tools.map((t) => t.name),
    ["get_balance", "get_statement"],
  );
  const { tools } = await (await connect(approvals())).listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_balance", "get_statement", "prepare_boleto", "pay_boleto"],
  );
  assert.equal(tools.find((t) => t.name === "pay_boleto").annotations.destructiveHint, true);
});

test("pays only the boleto the owner approved on the page, once", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  const prepared = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-25" }));
  assert.deepEqual(
    { ...prepared, approval: undefined, link: undefined },
    {
      payee: "LOJA EXEMPLO LTDA",
      amountCents: 26850,
      dueDate: "2026-10-25",
      paymentDate: "2026-10-26",
      approval: undefined,
      link: undefined,
    },
  );
  assert.equal(prepared.link, `https://sicoob.example.com/approve/${prepared.approval}`);
  const shown = await page(gate, prepared.link);
  for (const fact of [
    "LOJA EXEMPLO LTDA",
    "R$ 268,50",
    "Multa e juros",
    "25/10/2026",
    "Agendado para 26/10/2026",
    BARCODE,
  ])
    assert.ok(shown.includes(fact), fact);

  const pay = (approval) => call(agent, "pay_boleto", { approval });
  assert.match((await pay(prepared.approval)).content[0].text, /not approved it yet/);
  assert.match((await pay("made-up")).content[0].text, /No pending approval/);
  assert.equal(paid().length, 0);

  await approve(gate, prepared.link);
  assert.deepEqual(result(await pay(prepared.approval)), {
    id: 1000,
    state: "Agendado",
    paymentDate: "2026-10-26",
    payee: "LOJA EXEMPLO LTDA",
    amountCents: 26850,
  });
  const sent = JSON.parse(paid()[0].body);
  assert.deepEqual(
    [sent.amount, sent.valorBoleto, sent.valorMultaMora, sent.date, sent.identificadorConsulta],
    [268.5, 265, 3.5, "2026-10-26", "consulta-1"],
  );
  assert.deepEqual(
    [sent.nomePortador, sent.numeroCpfCnpjPortador],
    ["FULANO DE TAL", "00000000000"],
  );
  assert.deepEqual(sent.debtorAccount, {
    issuer: 3031,
    number: 1234567,
    accountType: 0,
    personType: 0,
  });
  assert.match([...payments.keys()][0], /^3031-1234567-[0-9a-f-]{36}$/);

  assert.match((await pay(prepared.approval)).content[0].text, /No pending approval/);
  assert.equal(paid().length, 1);
});

test("a boleto already paid or scheduled is reported, not paid again", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  const first = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  await approve(gate, first.link);
  await call(agent, "pay_boleto", { approval: first.approval });
  // The answer was lost, so the agent prepares the same boleto again, by its barcode this time.
  assert.deepEqual(result(await call(agent, "prepare_boleto", { line: BARCODE })), {
    earlierPayment: { id: 1000, state: "Agendado", paymentDate: "2026-10-26" },
  });
  assert.equal(paid().length, 1);

  // A cancelled payment doesn't count: the boleto can be paid again, with a new key.
  payments.get([...payments.keys()][0]).situacaoPagamento = "Cancelado";
  const again = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  await approve(gate, again.link);
  assert.equal(
    result(await call(agent, "pay_boleto", { approval: again.approval })).state,
    "Agendado",
  );
  assert.equal(payments.size, 2);
});

test("a second approval for the same boleto never reports an amount Sicoob didn't pay", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  // Both are prepared before either is paid, so the boleto has no payment yet and both get the same key.
  const first = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  bill = { valorMultaMora: 4.5, valorPagamento: 269.5 };
  const second = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-27" }));
  assert.deepEqual(
    [first.amountCents, first.paymentDate, second.amountCents, second.paymentDate],
    [26850, "2026-10-26", 26950, "2026-10-27"],
  );
  await approve(gate, first.link);
  await approve(gate, second.link);

  assert.deepEqual(result(await call(agent, "pay_boleto", { approval: first.approval })), {
    id: 1000,
    state: "Agendado",
    paymentDate: "2026-10-26",
    payee: "LOJA EXEMPLO LTDA",
    amountCents: 26850,
  });
  // Sicoob answers the second key with the first payment: the second approval's day was never scheduled, so
  // its amount was never paid and must not be reported as if it had been.
  const replay = await call(agent, "pay_boleto", { approval: second.approval });
  assert.ok(replay.isError, replay.content[0].text);
  assert.equal(payments.size, 1);
  assert.equal(paid().length, 2);
});

test("a payment Sicoob rejects fails with its state, and the approval is used up", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  outcome = "Rejeitado";
  const prepared = result(await call(agent, "prepare_boleto", { line: LINE }));
  await approve(gate, prepared.link);
  assert.deepEqual(await call(agent, "pay_boleto", { approval: prepared.approval }), {
    isError: true,
    content: [{ type: "text", text: "Sicoob: HTTP 200, Rejeitado" }],
  });
  assert.match(
    (await call(agent, "pay_boleto", { approval: prepared.approval })).content[0].text,
    /No pending approval/,
  );
});

test("a receipt answered with no content means the key is free, not a failure", async () => {
  absence = 204;
  const gate = approvals();
  const agent = await connect(gate);
  const prepared = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  assert.deepEqual(
    [prepared.payee, prepared.amountCents, prepared.paymentDate],
    ["LOJA EXEMPLO LTDA", 26850, "2026-10-26"],
  );
  await approve(gate, prepared.link);
  assert.equal(
    result(await call(agent, "pay_boleto", { approval: prepared.approval })).state,
    "Agendado",
  );
});

test("refuses a mistyped line, a guia and an impossible date before Sicoob", async () => {
  const agent = await connect(approvals());
  const before = requests.length;
  for (const args of [
    { line: `${LINE.slice(0, -1)}1` },
    { line: "85870000000100000641234567890123456789012345" },
    { line: LINE, date: "2027-02-30" },
  ])
    assert.ok((await call(agent, "prepare_boleto", args)).isError, JSON.stringify(args));
  assert.equal(requests.length, before);
});

test("a boleto Sicoob blocks, or an answer for another boleto, is never offered for approval", async () => {
  const agent = await connect(approvals());
  for (const [change, error] of [
    [{ bloquearPagamento: true }, "Sicoob: HTTP 200, payment blocked"],
    [{ codigoBarras: `${BARCODE.slice(0, 43)}0` }, "Sicoob: unavailable"],
  ]) {
    bill = change;
    assert.deepEqual((await call(agent, "prepare_boleto", { line: LINE })).content[0].text, error);
  }
});
