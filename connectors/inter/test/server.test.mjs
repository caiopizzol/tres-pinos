// The server over HTTP: runs the real server.mjs in its own process and lists its tools through an MCP client.
// It never reaches Inter: listing tools needs no bank call.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certificates,
  KEY,
  listTools,
  readmeTools,
  refusesToStart,
  runningServer,
  siteTools,
} from "@tres-pinos/testing";

const SERVER = new URL("../src/server.mjs", import.meta.url);
// Two certificates, so a key that belongs to the other one can be given. Inter's keys have no password.
const certs = certificates({ owner: "/CN=EMPRESA FICTICIA LTDA", other: "/CN=OUTRA EMPRESA LTDA" });
const SETTINGS = {
  INTER_KEY: KEY,
  INTER_CLIENT_ID: "client-id",
  INTER_CLIENT_SECRET: "client-secret",
  INTER_CERT_PATH: certs.file("owner.crt"),
  INTER_CERT_KEY_PATH: certs.file("owner.key"),
};

test("only INTER_KEY gets in, and it offers only the two read tools", async () => {
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

// The README and the site list the tools by hand, so they must name every tool the server offers, and no other.
test("the README and the site name exactly the tools it offers", async () => {
  const names = (await listTools(await runningServer(SERVER, SETTINGS))).map((t) => t.name).sort();
  assert.deepEqual(readmeTools("inter"), names, "README");
  assert.deepEqual(siteTools("inter"), names, "site");
});

test(
  "refuses to start with a short key, a missing setting, or a certificate and key that don't match",
  { timeout: 10_000 },
  () => {
    const mismatch =
      /INTER_CERT_PATH and INTER_CERT_KEY_PATH are not a matching certificate and key/;
    return refusesToStart(SERVER, SETTINGS, [
      [{ INTER_KEY: "short" }, /INTER_KEY needs at least 32 characters/],
      [{ INTER_CLIENT_SECRET: "" }, /Set INTER_CLIENT_SECRET/],
      [{ INTER_CERT_PATH: certs.file("missing.crt") }, /Can't read .*missing\.crt/],
      [{ INTER_CERT_KEY_PATH: certs.file("other.key") }, mismatch],
      [
        { INTER_CERT_PATH: certs.file("owner.key"), INTER_CERT_KEY_PATH: certs.file("owner.crt") },
        mismatch,
      ],
    ]);
  },
);
