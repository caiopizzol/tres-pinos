// What the connectors share, apart from the certificate request, which each connector's tests run against
// its fake API.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allowOnly, isGuarded, readCertificate, toCents } from "../src/api.mjs";

const TOKEN_URL = "https://bank.example/token";
const guarded = (reply) =>
  allowOnly(async () => reply, {
    tokenUrl: TOKEN_URL,
    scopes: ["read"],
    requests: [/^GET https:\/\/bank\.example\/balance$/],
  });

test("the guard lets out only the read-only token and the listed requests", async () => {
  const fetch = guarded({ status: 200, text: "" });
  assert.ok(isGuarded(fetch));
  assert.ok(!isGuarded(async () => {}));
  await fetch(TOKEN_URL, { method: "POST", body: "grant_type=client_credentials&scope=read" });
  await fetch("https://bank.example/balance");
  for (const [url, init] of [
    [TOKEN_URL, { method: "POST", body: "scope=write" }],
    [TOKEN_URL, { method: "POST", body: "scope=read&scope=write" }],
    [TOKEN_URL, { method: "POST" }],
    [TOKEN_URL, { method: "GET", body: "scope=read" }],
    ["https://bank.example/balance", { method: "POST" }],
    ["https://bank.example/balance?x=1", {}],
    ["https://bank.example/pay", { method: "POST" }],
  ])
    await assert.rejects(fetch(url, init), /Refused/, `${init.method} ${url}`);
});

test("without a token URL, the guard lets out only the listed requests", async () => {
  const fetch = allowOnly(async () => ({ status: 200, text: "" }), {
    requests: [/^GET https:\/\/bank\.example\/balance$/],
  });
  await fetch("https://bank.example/balance");
  for (const [url, init] of [
    [undefined, { method: "POST" }],
    ["https://bank.example/token", { method: "POST", body: "scope=read" }],
    ["https://bank.example/balance", { method: "POST" }],
  ])
    await assert.rejects(fetch(url, init), /Refused/, `${init.method} ${url}`);
});

test("the guard refuses a redirect instead of following it", async () => {
  await assert.rejects(
    guarded({ status: 302, text: "" })("https://bank.example/balance"),
    /Refused a 302 redirect/,
  );
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

test("reads a certificate and key only when the password opens the key and the two match", () => {
  const dir = mkdtempSync(join(tmpdir(), "api-"));
  const file = (name) => join(dir, name);
  const pair = (name, password) =>
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-days", "1", "-subj", "/CN=test"]
        .concat(password ? ["-passout", `pass:${password}`] : ["-nodes"])
        .concat(["-keyout", file(`${name}.key`), "-out", file(`${name}.crt`)]),
      { stdio: "ignore" },
    );
  try {
    pair("locked", "test-password-123");
    pair("open");
    const env = (name, password, crt = name) => ({
      X_CERT_PATH: file(`${crt}.crt`),
      X_CERT_KEY_PATH: file(`${name}.key`),
      X_CERT_PASSWORD: password,
    });
    assert.equal(
      readCertificate(env("locked", "test-password-123"), "X").passphrase,
      "test-password-123",
    );
    assert.equal(readCertificate(env("open", ""), "X").passphrase, undefined);
    assert.throws(
      () => readCertificate(env("locked", "wrong"), "X"),
      /^Error: X_CERT_PASSWORD does not open X_CERT_KEY_PATH$/,
    );
    assert.throws(
      () => readCertificate(env("locked", ""), "X"),
      /X_CERT_PATH and X_CERT_KEY_PATH are not a matching certificate and key/,
    );
    assert.throws(
      () => readCertificate(env("open", "", "locked"), "X"),
      /X_CERT_PATH and X_CERT_KEY_PATH are not a matching certificate and key/,
    );
    assert.throws(
      () => readCertificate({ ...env("open", ""), X_CERT_PATH: file("missing.crt") }, "X"),
      /Can't read .*missing\.crt/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
