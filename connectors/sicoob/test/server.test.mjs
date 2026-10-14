// The server over HTTP: runs the real server.mjs in its own process and lists its tools through an MCP client.
// It never reaches Sicoob: listing tools needs no bank call.
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
} from "@tres-pinos/testing";

const SERVER = new URL("../src/server.mjs", import.meta.url);
// Two certificates with password-protected keys, so a certificate that doesn't match the key can be given.
const certs = certificates(
  { owner: "/CN=FULANO DE TAL:00000000000", other: "/CN=CICLANO DE TAL:00000000191" },
  { locked: true },
);
const SETTINGS = {
  SICOOB_KEY: KEY,
  SICOOB_CLIENT_ID: "client-id",
  SICOOB_ACCOUNT: "1234567",
  SICOOB_CERT_PATH: certs.file("owner.crt"),
  SICOOB_CERT_KEY_PATH: certs.file("owner.key"),
  SICOOB_CERT_PASSWORD: PASSWORD,
};

test("only SICOOB_KEY gets in, and it offers only the two read tools", async () => {
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
    ["get_balance", "get_statement"],
  );
  assert.ok(listed.every((t) => t.annotations.readOnlyHint));
});

// The README lists the tools by hand, so it must name every tool the server offers, and no other.
test("the README names exactly the tools it offers", async () => {
  const names = (await listTools(await runningServer(SERVER, SETTINGS))).map((t) => t.name).sort();
  assert.deepEqual(readmeTools("sicoob"), names, "README");
});

test(
  "refuses to start with a short key, a missing setting, a wrong certificate password, or a certificate and key that don't match",
  { timeout: 10_000 },
  () =>
    refusesToStart(SERVER, SETTINGS, [
      [{ SICOOB_KEY: "short" }, /SICOOB_KEY needs at least 32 characters/],
      [{ SICOOB_CLIENT_ID: "" }, /Set SICOOB_CLIENT_ID/],
      [{ SICOOB_ACCOUNT: "12-3" }, /digits only/],
      [
        { SICOOB_CERT_PASSWORD: "wrong-password" },
        /SICOOB_CERT_PASSWORD does not open SICOOB_CERT_KEY_PATH/,
      ],
      [
        { SICOOB_CERT_PATH: certs.file("other.crt") },
        /SICOOB_CERT_PATH and SICOOB_CERT_KEY_PATH are not a matching certificate and key/,
      ],
    ]),
);

// With PUBLIC_URL, an app on the internet signs in with the owner's key instead of holding it. The sign-ins live
// in DATA_DIR, here a folder deleted after the test.
test("with PUBLIC_URL, an app signs in on the consent page and gets only the read tools", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sicoob-data-"));
  after(() => rmSync(dataDir, { recursive: true, force: true }));
  const url = await runningServer(SERVER, (self) => ({
    ...SETTINGS,
    PUBLIC_URL: self,
    DATA_DIR: dataDir,
  }));
  const { tools, consentPage, server } = await signInAndListTools(url);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_balance", "get_statement"],
  );
  assert.equal(server.title, "Três Pinos · Sicoob");
  assert.deepEqual(server.icons, [
    { src: `${url}/icon.png`, mimeType: "image/png", sizes: ["192x192"] },
  ]);
  assert.match(consentPage, /seu Sicoob/);
  assert.match(consentPage, /Nunca movimenta dinheiro/);
});
