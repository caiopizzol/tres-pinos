// The server over HTTP: runs the real server.mjs in its own process and lists its tools through an MCP client.
// It never reaches the ADN: listing tools needs no request.
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
const PASSWORD = "test-password-123";
const dir = mkdtempSync(join(tmpdir(), "nfse-server-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name) => join(dir, name);
// Two certificates with password-protected keys, so a key that belongs to the other one can be given.
for (const name of ["owner", "other"])
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-passout",
      `pass:${PASSWORD}`,
      "-keyout",
      file(`${name}.key`),
      "-out",
      file(`${name}.crt`),
      "-days",
      "1",
      "-subj",
      "/CN=EMPRESA FICTICIA LTDA:00000000000191",
    ],
    { stdio: "ignore" },
  );
const SETTINGS = {
  NFSE_KEY: KEY,
  NFSE_CERT_PATH: file("owner.crt"),
  NFSE_CERT_KEY_PATH: file("owner.key"),
  NFSE_CERT_PASSWORD: PASSWORD,
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

async function tools(url) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const listed = (await client.listTools()).tools;
  await client.close();
  return listed;
}

test("only NFSE_KEY gets in, and it offers only the read tool", async () => {
  const url = await server();
  assert.equal(
    (await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: "Bearer guess" } }))
      .status,
    401,
  );
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
  const listed = await tools(url);
  assert.deepEqual(
    listed.map((t) => t.name),
    ["list_invoices"],
  );
  assert.ok(listed.every((t) => t.annotations.readOnlyHint));
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
  const names = (await tools(await server())).map((t) => t.name).sort();
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const site = readFileSync(new URL("../../../site/index.html", import.meta.url), "utf8");
  assert.deepEqual(readmeTools(readme), names, "README");
  assert.deepEqual(siteTools(site, "nfse"), names, "site");
});

test(
  "refuses to start with a short key, a missing setting, a wrong password, or a key that doesn't match",
  { timeout: 10_000 },
  async () => {
    for (const [settings, message] of [
      [{ NFSE_KEY: "short" }, /NFSE_KEY needs at least 32 characters/],
      [{ NFSE_CERT_PASSWORD: "" }, /Set NFSE_CERT_PASSWORD/],
      [{ NFSE_CERT_PATH: file("missing.crt") }, /Can't read .*missing\.crt/],
      [{ NFSE_CERT_PASSWORD: "wrong-password" }, /NFSE_CERT_PASSWORD does not open/],
      [
        { NFSE_CERT_KEY_PATH: file("other.key") },
        /NFSE_CERT_PATH and NFSE_CERT_KEY_PATH are not a matching certificate and key/,
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
  },
);
