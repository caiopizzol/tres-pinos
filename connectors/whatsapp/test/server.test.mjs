// The server over HTTP: runs the real server.mjs in its own process, against a fake WAHA.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, test } from "node:test";
import { fakeWaha } from "./fake-waha.mjs";

const KEY = "k".repeat(32);
const waha = await fakeWaha({ sessions: { personal: {} } });
after(() => waha.close());

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function start(port, settings) {
  const child = spawn(process.execPath, [new URL("../src/server.mjs", import.meta.url).pathname], {
    env: { ...process.env, WAHA_URL: waha.url, WAHA_API_KEY: "test", WHATSAPP_KEY: KEY, READ_SESSION: "personal", TRANSCRIBE_URL: "", PORT: String(port), ...settings },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  after(() => child.kill());
  return { child, stderr: () => stderr };
}

async function server(settings = {}) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  start(port, settings);
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${url}/mcp`, { method: "POST" }).then(() => true, () => false)) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("The server did not start");
}

test("only WHATSAPP_KEY gets in", async () => {
  const url = await server();
  const call = (headers) => fetch(`${url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal((await call({ Authorization: `Bearer ${KEY}` })).status, 200);
  assert.equal((await call({ Authorization: "Bearer guess" })).status, 401);
  assert.equal((await call({})).status, 401);
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
});

test("refuses to start with a key short enough to guess", async () => {
  for (const key of ["", "short-key"]) {
    const { child, stderr } = start(await freePort(), { WHATSAPP_KEY: key });
    assert.equal(await new Promise((resolve) => child.on("exit", resolve)), 1, JSON.stringify(key));
    assert.match(stderr(), /WHATSAPP_KEY needs at least 32 characters/);
  }
});
