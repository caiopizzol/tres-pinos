// What the bank connectors share, apart from the certificate request, which each connector's tests run against
// its fake bank.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadOnly, readOnly, toCents } from "../src/bank.mjs";

const TOKEN_URL = "https://bank.example/token";
const guarded = (reply) =>
  readOnly(async () => reply, {
    tokenUrl: TOKEN_URL,
    scope: "read",
    requests: [/^GET https:\/\/bank\.example\/balance$/],
  });

test("the guard lets out only the read-only token and the listed requests", async () => {
  const fetch = guarded({ status: 200, text: "" });
  assert.ok(isReadOnly(fetch));
  assert.ok(!isReadOnly(async () => {}));
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
