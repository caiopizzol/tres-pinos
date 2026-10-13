// The server over HTTP: runs the real server.mjs in its own process and lists its tools through an MCP client.
// It never reaches the ADN: listing tools needs no request.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  certificates,
  KEY,
  listTools,
  PASSWORD,
  readmeTools,
  refusesToStart,
  runningServer,
  signInAndListTools,
  siteTools,
} from "@tres-pinos/testing";

const SERVER = new URL("../src/server.mjs", import.meta.url);
// Two certificates with password-protected keys, so a key that belongs to the other one can be given.
const certs = certificates(
  { owner: "/CN=EMPRESA FICTICIA LTDA:00000000000191", other: "/CN=OUTRA EMPRESA LTDA" },
  { locked: true },
);
const SETTINGS = {
  NFSE_KEY: KEY,
  NFSE_CERT_PATH: certs.file("owner.crt"),
  NFSE_CERT_KEY_PATH: certs.file("owner.key"),
  NFSE_CERT_PASSWORD: PASSWORD,
};

test("only NFSE_KEY gets in, and it offers only the read tool", async () => {
  const url = await runningServer(SERVER, SETTINGS);
  assert.equal(
    (await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: "Bearer guess" } }))
      .status,
    401,
  );
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
  const listed = await listTools(url);
  assert.deepEqual(
    listed.map((t) => t.name),
    ["list_invoices"],
  );
  assert.ok(listed.every((t) => t.annotations.readOnlyHint));
});

// The README and the site list the tools by hand, so they must name every tool the server offers, and no other.
test("the README and the site name exactly the tools it offers", async () => {
  const names = (await listTools(await runningServer(SERVER, SETTINGS))).map((t) => t.name).sort();
  assert.deepEqual(readmeTools("nfse"), names, "README");
  assert.deepEqual(siteTools("nfse"), names, "site");
});

test(
  "refuses to start with a short key, a missing setting, a wrong password, or a key that doesn't match",
  { timeout: 10_000 },
  () =>
    refusesToStart(SERVER, SETTINGS, [
      [{ NFSE_KEY: "short" }, /NFSE_KEY needs at least 32 characters/],
      [{ NFSE_CERT_PASSWORD: "" }, /Set NFSE_CERT_PASSWORD/],
      [{ NFSE_CERT_PATH: certs.file("missing.crt") }, /Can't read .*missing\.crt/],
      [{ NFSE_CERT_PASSWORD: "wrong-password" }, /NFSE_CERT_PASSWORD does not open/],
      [
        { NFSE_CERT_KEY_PATH: certs.file("other.key") },
        /NFSE_CERT_PATH and NFSE_CERT_KEY_PATH are not a matching certificate and key/,
      ],
    ]),
);

// With PUBLIC_URL, an app on the internet signs in with the owner's key instead of holding it. The sign-ins live
// in DATA_DIR, here a folder deleted after the test.
test("with PUBLIC_URL, an app signs in on the consent page and gets only the read tools", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nfse-data-"));
  after(() => rmSync(dataDir, { recursive: true, force: true }));
  const url = await runningServer(SERVER, (self) => ({
    ...SETTINGS,
    PUBLIC_URL: self,
    DATA_DIR: dataDir,
  }));
  const { tools, consentPage } = await signInAndListTools(url);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["list_invoices"],
  );
  assert.match(consentPage, /sistema nacional da NFS-e/);
  assert.match(consentPage, /Nunca emite nem cancela notas/);
});
