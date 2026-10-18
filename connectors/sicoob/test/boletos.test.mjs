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

async function connect(gate, account = config.account) {
  const server = buildServer(
    sicoobClient({ ...config, account }, guard(client(), { pay: true })),
    undefined,
    gate,
  );
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
const status = async (agent, approval) => result(await call(agent, "get_approval", { approval }));

test("the payment tools appear only with the owner's approvals, and none of them pays", async () => {
  const readOnly = await connect(null);
  assert.deepEqual(
    (await readOnly.listTools()).tools.map((t) => t.name),
    ["get_balance", "get_statement"],
  );
  const { tools } = await (await connect(approvals())).listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_balance", "get_statement", "prepare_boleto", "get_approval"],
  );
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
});

test("approving on the page pays only that boleto, once, and the agent reads what came of it", async () => {
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
    "Aprovar e pagar",
  ])
    assert.ok(shown.includes(fact), fact);

  assert.deepEqual(await status(agent, prepared.approval), { status: "pending" });
  assert.match(
    (await call(agent, "get_approval", { approval: "made-up" })).content[0].text,
    /No approval with this id/,
  );
  assert.equal(paid().length, 0);

  const done = await approve(gate, prepared.link);
  for (const fact of ["Feito", "Agendado para 26/10/2026", "1000"])
    assert.ok(done.includes(fact), fact);
  assert.deepEqual(await status(agent, prepared.approval), {
    status: "done",
    result: {
      id: 1000,
      state: "Agendado",
      paymentDate: "2026-10-26",
      payee: "LOJA EXEMPLO LTDA",
      amountCents: 26850,
    },
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

  await approve(gate, prepared.link);
  assert.equal(paid().length, 1);
});

test("a boleto already paid or scheduled is reported, not paid again", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  const first = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  await approve(gate, first.link);
  // The agent prepares the same boleto again, by its barcode this time.
  assert.deepEqual(result(await call(agent, "prepare_boleto", { line: BARCODE })), {
    earlierPayment: { id: 1000, state: "Agendado", paymentDate: "2026-10-26" },
  });
  assert.equal(paid().length, 1);

  // A cancelled payment doesn't count: the boleto can be paid again, with a new key.
  payments.get([...payments.keys()][0]).situacaoPagamento = "Cancelado";
  const again = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  await approve(gate, again.link);
  assert.equal((await status(agent, again.approval)).result.state, "Agendado");
  assert.equal(payments.size, 2);
});

test("a second approval for the same boleto is answered with the payment already made", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  const first = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  // The payee raised the fine between the lookups, so the second approval quotes more for the very same day.
  bill = { valorMultaMora: 4.5, valorPagamento: 269.5 };
  const second = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  assert.deepEqual(
    [first.amountCents, second.amountCents, first.paymentDate, second.paymentDate],
    [26850, 26950, "2026-10-26", "2026-10-26"],
  );
  await approve(gate, first.link);
  assert.equal((await status(agent, first.approval)).result.amountCents, 26850);

  // The second approval pays nothing and is answered with the payment the first one made, never with its own
  // amount, which Sicoob was never asked for.
  assert.match(await approve(gate, second.link), /Nada foi pago agora/);
  assert.deepEqual(await status(agent, second.approval), {
    status: "done",
    result: { earlierPayment: { id: 1000, state: "Agendado", paymentDate: "2026-10-26" } },
  });
  assert.equal(paid().length, 1);
  assert.equal(payments.size, 1);
});

test("two approvals for the same boleto given at once send only one payment", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  const first = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  const second = result(await call(agent, "prepare_boleto", { line: LINE, date: "2026-10-26" }));

  // Both look for a key before either payment lands, so without the guard both would believe it is free.
  await Promise.all([approve(gate, first.link), approve(gate, second.link)]);
  const answers = await Promise.all([first, second].map((a) => status(agent, a.approval)));
  assert.deepEqual(
    answers.map((a) => a.status).sort(),
    ["done", "failed"],
    JSON.stringify(answers),
  );
  assert.equal(answers.find((a) => a.status === "done").result.state, "Agendado");
  assert.equal(paid().length, 1);
  assert.equal(payments.size, 1);
});

test("a payment Sicoob rejects fails with its state, on the page and for the agent, once", async () => {
  const gate = approvals();
  const agent = await connect(gate);
  outcome = "Rejeitado";
  const prepared = result(await call(agent, "prepare_boleto", { line: LINE }));
  assert.match(await approve(gate, prepared.link), /Não deu certo[\s\S]*HTTP 200, Rejeitado/);
  assert.deepEqual(await status(agent, prepared.approval), {
    status: "failed",
    error: "HTTP 200, Rejeitado",
  });
  await approve(gate, prepared.link);
  assert.equal(paid().length, 1);
});

test("the account written with a leading zero finds the payment made without it", async () => {
  const gate = approvals();
  const padded = await connect(gate, "01234567");
  const first = result(await call(padded, "prepare_boleto", { line: LINE, date: "2026-10-26" }));
  await approve(gate, first.link);
  assert.equal((await status(padded, first.approval)).result.state, "Agendado");

  // The owner drops the leading zero and the connector restarts: the same account, so the same payment.
  const plain = await connect(gate, "1234567");
  assert.deepEqual(result(await call(plain, "prepare_boleto", { line: BARCODE })), {
    earlierPayment: { id: 1000, state: "Agendado", paymentDate: "2026-10-26" },
  });
  assert.equal(paid().length, 1);
  assert.equal(payments.size, 1);
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
  assert.equal((await status(agent, prepared.approval)).result.state, "Agendado");
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
