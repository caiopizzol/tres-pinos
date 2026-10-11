// The server over HTTP, as remote clients reach it: runs the real server.mjs in its own process, against a
// fake WAHA, and signs in with the MCP SDK's own OAuth client through the consent page.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as tcp, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

// The server with PUBLIC_URL at its own address, so sign-in and /mcp are on one origin, as behind a tunnel.
function start(port, settings) {
  const data = mkdtempSync(join(tmpdir(), "tres-pinos-"));
  const child = spawn(process.execPath, [new URL("../src/server.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      WAHA_URL: waha.url,
      WAHA_API_KEY: "test",
      WHATSAPP_KEY: KEY,
      READ_SESSION: "personal",
      TRANSCRIBE_URL: "",
      PORT: String(port),
      DATA_DIR: data,
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      ...settings,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  after(() => {
    child.kill();
    rmSync(data, { recursive: true, force: true });
  });
  return { child, stderr: () => stderr };
}

async function server(settings = {}) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  start(port, settings);
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

// What a desktop client keeps between steps. "Opening the browser" is approving on the consent page here.
function provider(approve) {
  const saved = {};
  return {
    saved,
    redirectUrl: "http://127.0.0.1:33418/callback",
    clientMetadata: {
      client_name: "Test client",
      redirect_uris: ["http://127.0.0.1:33418/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => saved.client,
    saveClientInformation: (c) => (saved.client = c),
    tokens: () => saved.tokens,
    saveTokens: (t) => (saved.tokens = t),
    saveCodeVerifier: (v) => (saved.verifier = v),
    codeVerifier: () => saved.verifier,
    redirectToAuthorization: async (authorizationUrl) =>
      (saved.callback = await approve(authorizationUrl)),
  };
}

// The owner's browser: open the consent page, enter the key, follow the page to the callback.
async function ownerApproves(authorizationUrl, key = KEY) {
  const page = await fetch(authorizationUrl);
  assert.equal(page.status, 200);
  const res = await fetch(new URL("/authorize", authorizationUrl), {
    method: "POST",
    headers: { Origin: authorizationUrl.origin },
    body: new URLSearchParams({ query: authorizationUrl.search.slice(1), key, decision: "allow" }),
  });
  const target = /content="0;url=([^"]+)"/.exec(await res.text())?.[1];
  return target && new URL(target.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)));
}

async function connect(url, auth) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { authProvider: auth }),
  );
  return client;
}

test("an MCP client signs in through the consent page and lists the tools", async () => {
  const url = await server();
  const auth = provider(ownerApproves);
  // The first try has no token, so the client discovers the server, registers and sends the owner to approve.
  await assert.rejects(connect(url, auth), UnauthorizedError);
  assert.equal(
    auth.saved.callback.origin + auth.saved.callback.pathname,
    "http://127.0.0.1:33418/callback",
  );
  assert.equal(auth.saved.callback.searchParams.get("iss"), url);

  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    authProvider: auth,
  });
  await transport.finishAuth(auth.saved.callback.searchParams.get("code"));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("list_chats"), tools.join());
  await client.close();
});

test("a wrong key gets no code", async () => {
  const url = await server();
  const auth = provider((u) => ownerApproves(u, "guess"));
  await assert.rejects(connect(url, auth), UnauthorizedError);
  assert.equal(auth.saved.callback, undefined);
});

test("WHATSAPP_KEY works directly, and nothing else gets in", async () => {
  const url = await server();
  const call = (headers) =>
    fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  assert.equal((await call({ Authorization: `Bearer ${KEY}` })).status, 200);
  const refused = await call({ Authorization: "Bearer guess" });
  assert.equal(refused.status, 401);
  assert.match(
    refused.headers.get("www-authenticate"),
    /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
});

test("without PUBLIC_URL there is no sign-in, only WHATSAPP_KEY", async () => {
  const url = await server({ PUBLIC_URL: "" });
  assert.equal((await fetch(`${url}/.well-known/oauth-authorization-server`)).status, 404);
  const refused = await fetch(`${url}/mcp`, { method: "POST" });
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get("www-authenticate"), null);
});

// fetch can't send a malformed path, so this writes the request by hand.
const rawGet = (url, path) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const socket = tcp(Number(port), hostname, () =>
      socket.end(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
    );
    let reply = "";
    socket.on("data", (chunk) => (reply += chunk));
    socket.on("end", () => resolve(reply.split("\r\n")[0]));
    socket.on("error", reject);
  });

test("a malformed path gets 400 and the server keeps running, with or without sign-in", async () => {
  for (const settings of [{ PUBLIC_URL: "" }, {}]) {
    const url = await server(settings);
    assert.equal(await rawGet(url, "//["), "HTTP/1.1 400 Bad Request");
    assert.equal((await fetch(`${url}/elsewhere`)).status, 404, "still running");
  }
});

test("refuses to start with a key short enough to guess", async () => {
  for (const key of ["", "short-key"]) {
    const { child, stderr } = start(await freePort(), { WHATSAPP_KEY: key });
    assert.equal(await new Promise((resolve) => child.on("exit", resolve)), 1, JSON.stringify(key));
    assert.match(stderr(), /WHATSAPP_KEY needs at least 32 characters/);
  }
});
