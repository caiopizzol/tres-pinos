// The Sicoob client and its guard, against a fake Sicoob that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names and numbers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { certificateFetch } from "@tres-pinos/bank";
import { readOnly } from "../src/guard.mjs";
import { API_URL, getBalance, getStatement, SicoobError, TOKEN_URL } from "../src/sicoob.mjs";
import { buildServer } from "../src/tools.mjs";

const PASSWORD = "test-password-123";
const dir = mkdtempSync(join(tmpdir(), "sicoob-"));
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
for (const [name, subject, pass] of [
  ["server", "/CN=localhost", null],
  ["owner", "/CN=FULANO DE TAL:00000000000", PASSWORD],
]) {
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    ...(pass ? ["-passout", `pass:${pass}`] : ["-nodes"]),
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

// The fake answers like Sicoob for the token, balance and statement, and records each request.
const requests = [];
let reply = null;
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
      client: req.socket.getPeerCertificate().subject.CN,
    });
    const send = (status, value) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (reply) return send(...reply);
    if (req.url === "/token")
      return send(200, {
        access_token: "t",
        token_type: "Bearer",
        scope: new URLSearchParams(body).get("scope"),
      });
    if (req.url.startsWith("/conta-corrente/v4/saldo?"))
      return send(200, { resultado: { saldo: "1234.5", saldoLimite: 500 } });
    if (req.url.startsWith("/conta-corrente/v4/extrato/9/2026?")) {
      return send(200, {
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
      });
    }
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

// The real client, pointed at the fake: Sicoob's URLs are rewritten to it, and the fake's CA is trusted.
const owner = {
  cert: readFileSync(file("owner.crt")),
  key: readFileSync(file("owner.key")),
  passphrase: PASSWORD,
};
function client(identity = owner) {
  const real = certificateFetch({ ...identity, ca: readFileSync(file("ca.crt")) });
  return (url, init) => real(url.replace(TOKEN_URL, `${base}/token`).replace(API_URL, base), init);
}
const config = { clientId: "client-id", account: "1234567" };

test("reads the balance and a statement, presenting the owner's certificate", async () => {
  const fetch = readOnly(client());
  assert.deepEqual(await getBalance(config, fetch), { balanceCents: 123450, limitCents: 50000 });
  assert.deepEqual(await getStatement(config, fetch, 2026, 9), [
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
    certificateFetch({ ca: readFileSync(file("ca.crt")) })(`${base}/token`, { method: "POST" }),
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
  assert.throws(() => buildServer(config, client()), /readOnly/);
  buildServer(config, readOnly(client()));
});

test("an error carries Sicoob's code and status, never its message text", async () => {
  reply = [400, { mensagens: [{ codigo: "10320", mensagem: "Conta 1234567 sem permissão" }] }];
  const error = await getBalance(config, readOnly(client())).catch((e) => e);
  reply = null;
  assert.ok(error instanceof SicoobError);
  assert.equal(error.message, "Sicoob token request failed (HTTP 400): Sicoob code 10320");
  assert.doesNotMatch(error.message, /1234567/);
});
