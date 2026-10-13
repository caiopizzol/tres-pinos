// The Sicoob client and its guard, against a fake Sicoob that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names and numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { certificateFetch } from "@tres-pinos/api";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { readOnly } from "../src/guard.mjs";
import { API_URL, SicoobError, sicoobClient, TOKEN_URL } from "../src/sicoob.mjs";
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
  const sicoob = sicoobClient(config, readOnly(client()));
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

test("the guard refuses every request it wasn't built for, before the network", async () => {
  const before = requests.length;
  const fetch = readOnly(() => assert.fail("reached the network"));
  const refused = [
    [
      TOKEN_URL,
      { method: "POST", body: "grant_type=client_credentials&scope=pixpagamentos_escrita" },
    ],
    [TOKEN_URL, { method: "POST", body: "scope=cco_consulta&scope=pagamentos_inclusao" }],
    [`${API_URL}/pix-pagamentos/v2/pagamentos`, { method: "POST" }],
    [
      `${API_URL}/pagamentos/v3/boletos/pagamentos/00000000000000000000000000000000000000000000`,
      { method: "POST" },
    ],
    [`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1`, { method: "DELETE" }],
    [`${API_URL}/conta-corrente/v4/extrato/13/2026?numeroContaCorrente=1`, {}],
    [`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1&other=2`, {}],
    ["https://elsewhere.example/conta-corrente/v4/saldo?numeroContaCorrente=1", {}],
  ];
  for (const [url, init] of refused) await assert.rejects(fetch(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the guard refuses a redirect instead of following it", async () => {
  reply = [302, {}];
  await assert.rejects(
    readOnly(client())(`${API_URL}/conta-corrente/v4/saldo?numeroContaCorrente=1`, {}),
    /Refused a 302 redirect/,
  );
  reply = null;
});

test("the tools won't run on a fetch the guard didn't wrap", () => {
  assert.throws(() => buildServer(sicoobClient(config, client())), /readOnly/);
  buildServer(sicoobClient(config, readOnly(client())));
});

test("an error carries Sicoob's code and status, never its message text", async () => {
  reply = [400, { mensagens: [{ codigo: "10320", mensagem: "Conta 1234567 sem permissão" }] }];
  const error = await sicoobClient(config, readOnly(client()))
    .getBalance()
    .catch((e) => e);
  reply = null;
  assert.ok(error instanceof SicoobError);
  assert.equal(error.message, "Sicoob token request failed (HTTP 400): Sicoob code 10320");
  assert.doesNotMatch(error.message, /1234567/);
});
