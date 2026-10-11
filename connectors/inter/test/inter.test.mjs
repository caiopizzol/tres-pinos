// The Inter client and its guard, against a fake Inter that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { readOnly } from "../src/guard.mjs";
import {
  API_URL,
  certificateFetch,
  InterError,
  interClient,
  TOKEN_URL,
  toCents,
} from "../src/inter.mjs";
import { buildServer } from "../src/tools.mjs";

const dir = mkdtempSync(join(tmpdir(), "inter-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name) => join(dir, name);
const openssl = (...args) => execFileSync("openssl", args, { stdio: "ignore" });
openssl(
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  file("ca.key"),
  "-out",
  file("ca.crt"),
  "-days",
  "1",
  "-subj",
  "/CN=test-ca",
);
for (const [name, subject] of [
  ["server", "/CN=localhost"],
  ["owner", "/CN=EMPRESA FICTICIA LTDA"],
]) {
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    file(`${name}.key`),
    "-out",
    file(`${name}.csr`),
    "-subj",
    subject,
  );
  openssl(
    "x509",
    "-req",
    "-in",
    file(`${name}.csr`),
    "-CA",
    file("ca.crt"),
    "-CAkey",
    file("ca.key"),
    "-CAcreateserial",
    "-out",
    file(`${name}.crt`),
    "-days",
    "1",
  );
}

// The fake answers like Inter for the token, balance and statement, and records each request.
const requests = [];
let reply = null;
let tokens = 0;
const transaction = {
  idTransacao: "a1",
  dataInclusao: "2026-09-02 10:00:00",
  dataTransacao: "2026-09-02",
  tipoTransacao: "PIX",
  tipoOperacao: "D",
  valor: "12.3",
  titulo: "Pix enviado",
  descricao: "PIX ENVIADO - Fulano",
  numeroDocumento: "0",
  detalhes: { cpfCnpjRecebedor: "00000000000" },
};
const fake = createServer(
  {
    key: readFileSync(file("server.key")),
    cert: readFileSync(file("server.crt")),
    ca: readFileSync(file("ca.crt")),
    requestCert: true,
    rejectUnauthorized: true,
  },
  async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      path: req.url,
      body,
      auth: req.headers.authorization,
      client: req.socket.getPeerCertificate().subject.CN,
    });
    const send = (status, value) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/oauth/v2/token") {
      tokens++;
      return send(200, {
        access_token: `t${tokens}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: new URLSearchParams(body).get("scope"),
      });
    }
    if (reply) return send(...reply);
    if (req.url === "/banking/v2/saldo")
      return send(200, {
        disponivel: 1234.5,
        limite: 500,
        bloqueadoCheque: 0,
        dataReferencia: "2026-09-02",
      });
    if (
      req.url ===
      "/banking/v2/extrato/completo?dataInicio=2026-02-01&dataFim=2026-02-28&tamanhoPagina=10000"
    )
      return send(200, { totalPaginas: 1, transacoes: [transaction] });
    send(404, {});
  },
);
let base;
before(
  () =>
    new Promise((resolve) =>
      fake.listen(0, "127.0.0.1", () =>
        resolve((base = `https://localhost:${fake.address().port}`)),
      ),
    ),
);
after(() => fake.close());
beforeEach(() => {
  reply = null;
});

// The real client, pointed at the fake: Inter's URL is rewritten to it, and the fake's CA is trusted.
const owner = { cert: readFileSync(file("owner.crt")), key: readFileSync(file("owner.key")) };
function client(identity = owner) {
  const real = certificateFetch({ ...identity, ca: readFileSync(file("ca.crt")) });
  return (url, init) => real(url.replace(API_URL, base), init);
}
const config = { clientId: "client-id", clientSecret: "client-secret" };

test("reads the balance and a month's statement, presenting the integration's certificate", async () => {
  const inter = interClient(config, readOnly(client()));
  assert.deepEqual(await inter.getBalance(), { balanceCents: 123450, limitCents: 50000 });
  assert.deepEqual(await inter.getStatement(2026, 2), [
    {
      id: "a1",
      date: "2026-09-02",
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
});

test("asks for exactly one calendar month, leap years included", async () => {
  const urls = [];
  const inter = interClient(
    config,
    readOnly(async (url) => {
      urls.push(url);
      return url === TOKEN_URL
        ? { status: 200, text: '{"access_token":"t","scope":"extrato.read","expires_in":3600}' }
        : { status: 200, text: '{"transacoes":[]}' };
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
    certificateFetch({ ca: readFileSync(file("ca.crt")) })(`${base}/oauth/v2/token`, {
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

test("amounts become exact integer cents", () => {
  for (const [value, cents] of [
    ["12.3", 1230],
    ["-0.01", -1],
    ["1000", 100000],
    [1234.5, 123450],
    [0.1, 10],
    ["5.00", 500],
  ])
    assert.equal(toCents(value), cents, String(value));
  for (const value of ["1.234", 1.0000000001, "abc", "", null, Number.NaN])
    assert.throws(() => toCents(value), String(value));
});
