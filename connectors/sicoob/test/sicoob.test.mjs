// The Sicoob client and its guard, against a fake Sicoob that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names and numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateFetch } from "@tres-pinos/api";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { guard } from "../src/guard.mjs";
import { API_URL, paced, SicoobError, sicoobClient, TOKEN_URL } from "../src/sicoob.mjs";
import { buildServer } from "../src/tools.mjs";

const certs = certificates(
  { server: "/CN=localhost", owner: "/CN=FULANO DE TAL:00000000000" },
  { locked: true },
);

// The fake answers like Sicoob for the token, balance and statement, or with `reply` when it is set.
let reply = null;
const fake = fakeApi(certs, ({ path, body }) => {
  if (reply) return reply;
  if (path === "/token")
    return [
      200,
      { access_token: "t", token_type: "Bearer", scope: new URLSearchParams(body).get("scope") },
    ];
  if (path.startsWith("/conta-corrente/v4/saldo?"))
    return [200, { resultado: { saldo: "1234.5", saldoLimite: 500 } }];
  if (path.startsWith("/conta-corrente/v4/extrato/9/2026?"))
    return [
      200,
      {
        resultado: {
          transacoes: [
            {
              transactionId: "a1",
              data: "2026-09-02",
              tipo: "DEBITO",
              valor: "12.30",
              descricao: "PIX ENVIADO",
            },
          ],
        },
      },
    ];
  return [404, {}];
});
const { requests } = fake;

// The real client, pointed at the fake: Sicoob's URLs are rewritten to it, and the fake's CA is trusted.
function client(identity = certs.identity("owner")) {
  const real = certificateFetch({ ...identity, ca: certs.read("ca.crt") });
  return (url, init) =>
    real(url.replace(TOKEN_URL, `${fake.url()}/token`).replace(API_URL, fake.url()), init);
}
const config = { clientId: "client-id", account: "1234567" };

test("reads the balance and a statement, presenting the owner's certificate", async () => {
  const sicoob = sicoobClient(config, guard(client()));
  assert.deepEqual(await sicoob.getBalance(), { balanceCents: 123450, limitCents: 50000 });
  assert.deepEqual(await sicoob.getStatement(2026, 9), [
    { id: "a1", date: "2026-09-02", type: "DEBITO", amountCents: 1230, description: "PIX ENVIADO" },
  ]);
  assert.ok(requests.every((r) => r.client === "FULANO DE TAL:00000000000"));
  assert.ok(
    requests
      .filter((r) => r.path === "/token")
      .every((r) => new URLSearchParams(r.body).get("scope") === "cco_consulta"),
  );
});

test("Sicoob refuses a client with no certificate", async () => {
  await assert.rejects(
    certificateFetch({ ca: certs.read("ca.crt") })(`${fake.url()}/token`, { method: "POST" }),
  );
});

const BARCODE = "75697158600000265001234567890123456789012345";
const KEY = "3031-1234567-00000000-0000-4000-8000-000000000000";
const token = (scope) => [TOKEN_URL, { method: "POST", body: `scope=${scope}` }];
const lookup = `${API_URL}/pagamentos/v3/boletos/${BARCODE}?numeroConta=1234567&dataPagamento=2026-10-26`;
const receipt = `${API_URL}/pagamentos/v3/boletos/pagamentos/${KEY}/idempotency/comprovantes?numeroConta=1234567`;
const payment = [`${API_URL}/pagamentos/v3/boletos/pagamentos/${BARCODE}`, { method: "POST" }];

test("the guard refuses every request it wasn't built for, before the network", async () => {
  const before = requests.length;
  const fetch = guard(() => assert.fail("reached the network"));
  const refused = [
    token("pixpagamentos_escrita"),
    token("pagamentos_consulta"),
    token("pagamentos_inclusao"),
    [TOKEN_URL, { method: "POST", body: "scope=cco_consulta&scope=pagamentos_inclusao" }],
    [`${API_URL}/pix-pagamentos/v2/pagamentos`, { method: "POST" }],
    [lookup, {}],
    [receipt, {}],
    payment,
    [`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1`, { method: "DELETE" }],
    [`${API_URL}/conta-corrente/v4/extrato/13/2026?numeroContaCorrente=1`, {}],
    [`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1&other=2`, {}],
    ["https://elsewhere.example/conta-corrente/v4/saldo?numeroContaCorrente=1", {}],
  ];
  for (const [url, init] of refused) await assert.rejects(fetch(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("with paying on, the guard lets out boleto payments and nothing else new", async () => {
  const before = requests.length;
  const fetch = guard(async () => ({ status: 200, text: "" }), { pay: true });
  for (const [url, init] of [
    token("pagamentos_consulta"),
    token("pagamentos_inclusao"),
    [lookup, {}],
    [receipt, {}],
    payment,
  ])
    await fetch(url, init);
  const refused = [
    token("pixpagamentos_escrita"),
    token("pagamentos_alteracao"),
    [`${API_URL}/pix-pagamentos/v2/pagamentos`, { method: "POST" }],
    // Cancelling a scheduled boleto.
    [`${API_URL}/pagamentos/v3/boletos/pagamentos/agendamentos/123`, { method: "DELETE" }],
    // A guia, which starts with 8.
    [`${API_URL}/pagamentos/v3/boletos/pagamentos/8${BARCODE.slice(1)}`, { method: "POST" }],
    [`${API_URL}/pagamentos/v3/boletos/pagamentos/${BARCODE}0`, { method: "POST" }],
    [`${lookup}&other=1`, {}],
  ];
  for (const [url, init] of refused) await assert.rejects(fetch(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the guard refuses a redirect instead of following it", async () => {
  reply = [302, {}];
  await assert.rejects(
    guard(client())(`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1`, {}),
    /Refused a 302 redirect/,
  );
  reply = null;
});

test("the tools won't run on a fetch the guard didn't wrap", () => {
  assert.throws(() => buildServer(sicoobClient(config, client())), /guarded fetch/);
  buildServer(sicoobClient(config, guard(client())));
});

test("an error carries Sicoob's code and status, never its message text", async () => {
  reply = [400, { mensagens: [{ codigo: "10320", mensagem: "Conta 1234567 sem permissão" }] }];
  const error = await sicoobClient(config, guard(client()))
    .getBalance()
    .catch((e) => e);
  reply = null;
  assert.ok(error instanceof SicoobError);
  assert.equal(error.message, "Sicoob token request failed (HTTP 400): Sicoob code 10320");
  assert.doesNotMatch(error.message, /1234567/);
});

test("a message Sicoob is known to send carries no data, so it reaches the agent in words", async () => {
  reply = [
    422,
    {
      mensagens: [
        { codigo: "0001", mensagem: "O seu limite diário para a operação foi excedido!" },
      ],
    },
  ];
  const error = await sicoobClient(config, guard(client()))
    .getBalance()
    .catch((e) => e);
  reply = null;
  assert.equal(
    error.reason,
    "Sicoob code 0001, the account's daily limit for this operation was exceeded",
  );
});

test("requests to the payments API go out at most 2 per second, and the account's are not held", async () => {
  const sent = [];
  const fetch = paced(async (url) => sent.push([url, Date.now()]), 100);
  const pay = `${API_URL}/pagamentos/v3/boletos/x`;
  const start = Date.now();
  await Promise.all([fetch(pay), fetch(TOKEN_URL), fetch(pay), fetch(pay)]);
  const times = sent.filter(([url]) => url === pay).map(([, at]) => at - start);
  assert.ok(times[1] >= 95 && times[2] >= 195, String(times));
  assert.ok(sent.find(([url]) => url === TOKEN_URL)[1] - start < 50);
});
