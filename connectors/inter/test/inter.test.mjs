// The Inter client and its guard, against a fake Inter that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { certificateFetch } from "@tres-pinos/api";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { readOnly } from "../src/guard.mjs";
import { API_URL, InterError, interClient, TOKEN_URL } from "../src/inter.mjs";
import { buildServer } from "../src/tools.mjs";

const certs = certificates({ server: "/CN=localhost", owner: "/CN=EMPRESA FICTICIA LTDA" });

// The fake answers like Inter for the token, balance and statement, or with `reply` when it is set.
let reply = null;
let tokens = 0;
const transaction = {
  idTransacao: "a1",
  dataInclusao: "2026-02-02 10:00:00",
  dataTransacao: "2026-02-02",
  tipoTransacao: "PIX",
  tipoOperacao: "D",
  valor: "12.3",
  titulo: "Pix enviado",
  descricao: "PIX ENVIADO - Fulano",
  numeroDocumento: "0",
  detalhes: { cpfCnpjRecebedor: "00000000000" },
};
const fake = fakeApi(certs, ({ path, body }) => {
  if (path === "/oauth/v2/token") {
    tokens++;
    return [
      200,
      {
        access_token: `t${tokens}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: new URLSearchParams(body).get("scope"),
      },
    ];
  }
  if (reply) return reply;
  if (path === "/banking/v2/saldo")
    return [
      200,
      {
        disponivel: 1234.5,
        limite: 500,
        bloqueadoCheque: 0,
        dataReferencia: "2026-09-02",
      },
    ];
  if (
    path ===
    "/banking/v2/extrato/completo?dataInicio=2026-02-01&dataFim=2026-02-28&tamanhoPagina=10000"
  )
    return [200, { totalPaginas: 1, transacoes: [transaction] }];
  return [404, {}];
});
const { requests } = fake;
beforeEach(() => {
  reply = null;
});

// The real client, pointed at the fake: Inter's URL is rewritten to it, and the fake's CA is trusted.
function client(identity = certs.identity("owner")) {
  const real = certificateFetch({ ...identity, ca: certs.read("ca.crt") });
  return (url, init) => real(url.replace(API_URL, fake.url()), init);
}
const config = { clientId: "client-id", clientSecret: "client-secret" };

test("reads the balance and a month's statement, presenting the integration's certificate", async () => {
  const inter = interClient(config, readOnly(client()));
  assert.deepEqual(await inter.getBalance(), { balanceCents: 123450, limitCents: 50000 });
  assert.deepEqual(await inter.getStatement(2026, 2), [
    {
      id: "a1",
      date: "2026-02-02",
      type: "DEBITO",
      amountCents: 1230,
      title: "Pix enviado",
      description: "PIX ENVIADO - Fulano",
    },
  ]);
  assert.ok(requests.every((r) => r.client === "EMPRESA FICTICIA LTDA"));
  const token = requests.find((r) => r.path === "/oauth/v2/token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
    client_id: "client-id",
    client_secret: "client-secret",
    grant_type: "client_credentials",
    scope: "extrato.read",
  });
});

test("a limit Inter leaves out is null, not 0", async () => {
  const inter = interClient(config, readOnly(client()));
  reply = [200, { disponivel: 10 }];
  assert.deepEqual(await inter.getBalance(), { balanceCents: 1000, limitCents: null });
  reply = [200, { disponivel: 10, limite: null }];
  assert.deepEqual(await inter.getBalance(), { balanceCents: 1000, limitCents: null });
  reply = [200, { disponivel: 10, limite: "x" }];
  await assert.rejects(inter.getBalance(), /invalid amount/);
});

// Inter allows only about five tokens a minute, so asking for one per call fails under normal use.
test("keeps one token until shortly before it expires, shared by concurrent calls", async () => {
  let clock = 0;
  const inter = interClient(config, readOnly(client()), () => clock);
  const before = tokens;
  await Promise.all([inter.getBalance(), inter.getBalance(), inter.getStatement(2026, 2)]);
  await inter.getBalance();
  assert.equal(tokens - before, 1);
  clock = (3600 - 61) * 1000;
  await inter.getBalance();
  assert.equal(tokens - before, 1);
  clock = (3600 - 60) * 1000;
  await inter.getBalance();
  assert.equal(tokens - before, 2);
  // A token Inter no longer accepts is replaced on the next call, not kept for the rest of the hour.
  reply = [401, {}];
  await assert.rejects(inter.getBalance(), /HTTP 401/);
  reply = null;
  await inter.getBalance();
  assert.equal(tokens - before, 3);
  assert.equal(requests.at(-1).auth, `Bearer t${tokens}`);
});

test("a failed token request is not kept: the next call asks again", async () => {
  let fail = true;
  const real = readOnly(client());
  const inter = interClient(
    config,
    readOnly((url, init) =>
      fail && url === TOKEN_URL ? Promise.resolve({ status: 429, text: "" }) : real(url, init),
    ),
  );
  await assert.rejects(inter.getBalance(), /token request failed \(HTTP 429\)/);
  fail = false;
  assert.equal((await inter.getBalance()).balanceCents, 123450);
});

test("refuses a statement month with more transactions than one request returns", async () => {
  reply = [200, { totalPaginas: 2, transacoes: [transaction] }];
  await assert.rejects(
    interClient(config, readOnly(client())).getStatement(2026, 2),
    /more than 10000/,
  );
  // Without a page count that matches, a first page cut short would look like the whole month.
  for (const body of [
    { transacoes: [transaction] },
    { totalPaginas: "1", transacoes: [transaction] },
    { totalPaginas: 0, transacoes: [transaction] },
    { totalPaginas: 1, transacoes: [] },
  ]) {
    reply = [200, body];
    await assert.rejects(
      interClient(config, readOnly(client())).getStatement(2026, 2),
      /no page count/,
      JSON.stringify(body),
    );
  }
});

test("asks for exactly one calendar month, leap years included", async () => {
  const urls = [];
  const inter = interClient(
    config,
    readOnly(async (url) => {
      urls.push(url);
      return url === TOKEN_URL
        ? { status: 200, text: '{"access_token":"t","scope":"extrato.read","expires_in":3600}' }
        : { status: 200, text: '{"totalPaginas":0,"transacoes":[]}' };
    }),
  );
  for (const [year, month] of [
    [2028, 2],
    [2026, 2],
    [2026, 12],
    [2026, 4],
  ])
    await inter.getStatement(year, month);
  assert.deepEqual(
    urls.filter((u) => u !== TOKEN_URL).map((u) => new URL(u).search),
    [
      "?dataInicio=2028-02-01&dataFim=2028-02-29&tamanhoPagina=10000",
      "?dataInicio=2026-02-01&dataFim=2026-02-28&tamanhoPagina=10000",
      "?dataInicio=2026-12-01&dataFim=2026-12-31&tamanhoPagina=10000",
      "?dataInicio=2026-04-01&dataFim=2026-04-30&tamanhoPagina=10000",
    ],
  );
});

test("Inter refuses a client with no certificate", async () => {
  await assert.rejects(
    certificateFetch({ ca: certs.read("ca.crt") })(`${fake.url()}/oauth/v2/token`, {
      method: "POST",
    }),
  );
});

test("the guard refuses every request it wasn't built for, before the network", async () => {
  const before = requests.length;
  const fetch = readOnly(() => assert.fail("reached the network"));
  const statement = `${API_URL}/banking/v2/extrato/completo?dataInicio=2026-09-01&dataFim=2026-09-30`;
  const refused = [
    [
      TOKEN_URL,
      { method: "POST", body: "grant_type=client_credentials&scope=pagamento-pix.write" },
    ],
    [TOKEN_URL, { method: "POST", body: "scope=extrato.read&scope=pagamento-boleto.write" }],
    [TOKEN_URL, { method: "POST", body: "scope=extrato.read%20pagamento-pix.write" }],
    [TOKEN_URL, { method: "GET" }],
    [`${API_URL}/banking/v2/pix`, { method: "POST" }],
    [`${API_URL}/banking/v2/pagamento`, { method: "POST" }],
    [`${API_URL}/banking/v2/pagamento/00000000-0000-0000-0000-000000000000`, { method: "DELETE" }],
    [`${API_URL}/banking/v2/saldo`, { method: "DELETE" }],
    [`${API_URL}/banking/v2/saldo?dataSaldo=2026-09-01`, {}],
    [`${API_URL}/banking/v2/extrato?dataInicio=2026-09-01&dataFim=2026-09-30`, {}],
    [`${statement}&tamanhoPagina=10000&pagina=1`, {}],
    [`${statement}&tamanhoPagina=50`, {}],
    ["https://elsewhere.example/banking/v2/saldo", {}],
  ];
  for (const [url, init] of refused) await assert.rejects(fetch(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the guard refuses a redirect instead of following it", async () => {
  reply = [302, {}];
  await assert.rejects(
    readOnly(client())(`${API_URL}/banking/v2/saldo`, {}),
    /Refused a 302 redirect/,
  );
});

test("the tools won't run on a fetch the guard didn't wrap", () => {
  assert.throws(() => buildServer(interClient(config, client())), /readOnly/);
  buildServer(interClient(config, readOnly(client())));
});

test("an error carries Inter's status, never its message text", async () => {
  reply = [400, { title: "Dados inválidos.", detail: "Conta 1234567", violacoes: [] }];
  const error = await interClient(config, readOnly(client()))
    .getBalance()
    .catch((e) => e);
  assert.ok(error instanceof InterError);
  assert.equal(error.message, "Inter balance request failed (HTTP 400)");
});
