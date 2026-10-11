// The server over HTTP: runs the real server.mjs in its own process and lists its tools through an MCP client.
// It never reaches Sicoob: listing tools needs no bank call.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const KEY = "k".repeat(32);
const dir = mkdtempSync(join(tmpdir(), "sicoob-server-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name) => join(dir, name);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-passout",
    "pass:test-password-123",
    "-keyout",
    file("key.pem"),
    "-out",
    file("cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=FULANO DE TAL:00000000000",
  ],
  { stdio: "ignore" },
);
const SETTINGS = {
  SICOOB_KEY: KEY,
  SICOOB_CLIENT_ID: "client-id",
  SICOOB_ACCOUNT: "1234567",
  SICOOB_CERT_PATH: file("cert.pem"),
  SICOOB_CERT_KEY_PATH: file("key.pem"),
  SICOOB_CERT_PASSWORD: "test-password-123",
};

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function start(port, settings) {
  const child = spawn(process.execPath, [new URL("../src/server.mjs", import.meta.url).pathname], {
    env: { ...process.env, ...SETTINGS, PORT: String(port), ...settings },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  after(() => child.kill());
  return { child, stderr: () => stderr };
}

async function server() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  start(port, {});
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(`${url}/mcp`, { method: "POST" }).then(
        () => true,
        () => false,
      )
    )
      return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("The server did not start");
}

test("only SICOOB_KEY gets in, and it offers only the two read tools", async () => {
  const url = await server();
  assert.equal(
    (await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: "Bearer guess" } }))
      .status,
    401,
  );
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const tools = (await client.listTools()).tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_balance", "get_statement"],
  );
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
  await client.close();
});

// The tool names in the first column of the README's "## Ferramentas" table, and of the site's table with this id.
function readmeTools(markdown) {
  const section = markdown.split("## Ferramentas")[1].split("\n## ")[0];
  return toolNames(
    section
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|")[1]),
  );
}
function siteTools(html, id) {
  const table = html.split(`id="${id}"`)[1].split("</table>")[0];
  return toolNames([...table.matchAll(/<tr>\s*<td>(.*?)<\/td>/g)].map((match) => match[1]));
}
const toolNames = (cells) => [...new Set(cells.join(" ").match(/\b[a-z]+(?:_[a-z]+)+\b/g))].sort();

// The README and the site list the tools by hand, so they must name every tool the server offers, and no other.
test("the README and the site name exactly the tools it offers", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${await server()}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  await client.close();
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const site = readFileSync(new URL("../../../site/index.html", import.meta.url), "utf8");
  assert.deepEqual(readmeTools(readme), tools, "README");
  assert.deepEqual(siteTools(site, "sicoob"), tools, "site");
});

test("refuses to start with a short key, a missing setting, or a wrong certificate password", async () => {
  for (const [settings, message] of [
    [{ SICOOB_KEY: "short" }, /SICOOB_KEY needs at least 32 characters/],
    [{ SICOOB_CLIENT_ID: "" }, /Set SICOOB_CLIENT_ID/],
    [{ SICOOB_ACCOUNT: "12-3" }, /digits only/],
    [
      { SICOOB_CERT_PASSWORD: "wrong-password" },
      /SICOOB_CERT_PASSWORD does not open SICOOB_CERT_KEY_PATH/,
    ],
  ]) {
    const { child, stderr } = start(await freePort(), settings);
    assert.equal(
      await new Promise((resolve) => child.on("exit", resolve)),
      1,
      JSON.stringify(settings),
    );
    assert.match(stderr(), message);
  }
});
