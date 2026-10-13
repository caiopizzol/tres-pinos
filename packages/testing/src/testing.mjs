// What the connectors' tests share: certificates, a fake API that accepts only a client certificate signed by its
// CA, the real server in its own process, and the tool tables that the README and the site keep by hand.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const KEY = "k".repeat(32);
export const PASSWORD = "test-password-123";

const openssl = (...args) => execFileSync("openssl", args, { stdio: "ignore" });

// A folder, deleted after the tests, with a CA and a certificate it signed for each entry of `subjects`
// ({ name: "/CN=..." }). With `locked`, keys open with PASSWORD, except the "server" one, which a fakeApi uses.
// `file` gives a path in the folder, `read` its contents, and `identity` a name's certificate and key, ready for
// certificateFetch.
export function certificates(subjects, { locked = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tres-pinos-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name) => join(dir, name);
  const read = (name) => readFileSync(file(name));
  const ca = ["-CA", file("ca.crt"), "-CAkey", file("ca.key"), "-CAcreateserial"];
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=test-ca",
    "-keyout",
    file("ca.key"),
    "-out",
    file("ca.crt"),
  );
  for (const [name, subject] of Object.entries(subjects)) {
    const lock = locked && name !== "server" ? ["-passout", `pass:${PASSWORD}`] : ["-nodes"];
    openssl(
      "req",
      "-newkey",
      "rsa:2048",
      ...lock,
      "-subj",
      subject,
      "-keyout",
      file(`${name}.key`),
      "-out",
      file(`${name}.csr`),
    );
    openssl(
      "x509",
      "-req",
      "-days",
      "1",
      "-in",
      file(`${name}.csr`),
      "-out",
      file(`${name}.crt`),
      ...ca,
    );
  }
  const identity = (name) => ({
    cert: read(`${name}.crt`),
    key: read(`${name}.key`),
    ...(locked && { passphrase: PASSWORD }),
  });
  return { file, read, identity };
}

// An HTTPS server like the official APIs: it accepts only a client certificate signed by the CA of `certs`, which
// must have a "server" certificate for localhost. Each request is recorded in `requests` as { method, path, body,
// auth, client }, where client is the name on its certificate, and `handle` answers it with [status, body]; a
// string body goes out as is. `url()` is the base URL, once the tests start.
export function fakeApi(certs, handle) {
  const requests = [];
  const server = createHttpsServer(
    {
      key: certs.read("server.key"),
      cert: certs.read("server.crt"),
      ca: certs.read("ca.crt"),
      requestCert: true,
      rejectUnauthorized: true,
    },
    async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = {
        method: req.method,
        path: req.url,
        body,
        auth: req.headers.authorization,
        client: req.socket.getPeerCertificate().subject.CN,
      };
      requests.push(request);
      const [status, value] = await handle(request);
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(typeof value === "string" ? value : JSON.stringify(value));
    },
  );
  let url;
  before(
    () =>
      new Promise((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve((url = `https://localhost:${server.address().port}`)),
        ),
      ),
  );
  after(() => server.close());
  return { requests, url: () => url };
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// Runs a connector's server.mjs in its own process with `settings`, killed after the tests. `settings` can be a
// function of the server's URL, for settings such as PUBLIC_URL that must name it.
export function startServer(script, settings) {
  return freePort().then((port) => {
    const url = `http://127.0.0.1:${port}`;
    const env = typeof settings === "function" ? settings(url) : settings;
    const child = spawn(process.execPath, [script.pathname], {
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    after(() => child.kill());
    return { child, url, stderr: () => stderr };
  });
}

// Starts the server and waits until it answers.
export async function runningServer(script, settings) {
  const { url } = await startServer(script, settings);
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

// Each pair of settings must stop the server before it starts, with a message that matches.
export async function refusesToStart(script, settings, cases) {
  for (const [changes, message] of cases) {
    const { child, stderr } = await startServer(script, { ...settings, ...changes });
    assert.equal(
      await new Promise((resolve) => child.on("exit", resolve)),
      1,
      JSON.stringify(changes),
    );
    assert.match(stderr(), message);
  }
}

// The tools a running server lists to a client with the key.
export async function listTools(url) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

// Signs in to a server started with PUBLIC_URL as an MCP client would: it registers, the owner approves on the
// consent page with the key, and the client gets a token. Returns the tools listed with that token, and the
// consent page, which tells the owner what the connector reaches.
export async function signInAndListTools(url) {
  const saved = {};
  let consentPage;
  const auth = {
    redirectUrl: "http://127.0.0.1:33418/callback",
    clientMetadata: {
      client_name: "Test client",
      redirect_uris: ["http://127.0.0.1:33418/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => saved.client,
    saveClientInformation: (client) => (saved.client = client),
    tokens: () => saved.tokens,
    saveTokens: (tokens) => (saved.tokens = tokens),
    saveCodeVerifier: (verifier) => (saved.verifier = verifier),
    codeVerifier: () => saved.verifier,
    // The owner's browser: open the consent page, enter the key, follow the page to the callback.
    async redirectToAuthorization(authorizationUrl) {
      const page = await fetch(authorizationUrl);
      assert.equal(page.status, 200);
      consentPage = await page.text();
      const res = await fetch(new URL("/authorize", authorizationUrl), {
        method: "POST",
        headers: { Origin: authorizationUrl.origin },
        body: new URLSearchParams({
          query: authorizationUrl.search.slice(1),
          key: KEY,
          decision: "allow",
        }),
      });
      const target = /content="0;url=([^"]+)"/.exec(await res.text())?.[1];
      saved.callback = new URL(target.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)));
    },
  };
  const transport = () =>
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { authProvider: auth });
  // The first try has no token, so the client discovers the server, registers and sends the owner to approve.
  await assert.rejects(
    new Client({ name: "test", version: "0" }).connect(transport()),
    UnauthorizedError,
  );
  const signedIn = transport();
  await signedIn.finishAuth(saved.callback.searchParams.get("code"));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(signedIn);
  const { tools } = await client.listTools();
  await client.close();
  return { tools, consentPage };
}

const toolNames = (cells) => [...new Set(cells.join(" ").match(/\b[a-z]+(?:_[a-z]+)+\b/g))].sort();

// The tool names in the first column of the "## Ferramentas" table of the connector's README.
export function readmeTools(connector) {
  const markdown = readFileSync(
    new URL(`../../../connectors/${connector}/README.md`, import.meta.url),
    "utf8",
  );
  const section = markdown.split("## Ferramentas")[1].split("\n## ")[0];
  return toolNames(
    section
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|")[1]),
  );
}

// The tool names in the first column of the site's table with the connector's id.
export function siteTools(connector) {
  const html = readFileSync(new URL("../../../site/index.html", import.meta.url), "utf8");
  const table = html.split(`id="${connector}"`)[1].split("</table>")[0];
  return toolNames([...table.matchAll(/<tr>\s*<td>(.*?)<\/td>/g)].map((match) => match[1]));
}
