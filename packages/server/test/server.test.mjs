// serve() over HTTP, as clients reach it: a key for clients on the same machine, and, with publicUrl, OAuth
// sign-in through the consent page, run with the MCP SDK's own client.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, connect as tcp } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serve, toolAnswer } from "../src/server.mjs";

const KEY = "k".repeat(32);
const tools = () => {
  const server = new McpServer({ name: "test", version: "0" });
  server.registerTool("ping", { description: "Answers pong." }, () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  return server;
};

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// serve() on a free port. With sign-in, publicUrl is its own address, as behind a tunnel.
async function start({ signIn = true } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "tres-pinos-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = serve({
    name: "TEST_KEY",
    key: KEY,
    tools,
    port,
    publicUrl: signIn ? url : undefined,
    dataDir,
    consent: { title: "Banco Fictício", reach: "Ele vai poder ler o saldo." },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  after(() => {
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return url;
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

const connect = (url, auth) =>
  new Client({ name: "test", version: "0" }).connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { authProvider: auth }),
  );

const listTools = (url, headers) =>
  fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

test("an MCP client signs in through the consent page and lists the tools", async () => {
  const url = await start();
  const auth = provider(ownerApproves);
  // The first try has no token, so the client discovers the server, registers and sends the owner to approve.
  await assert.rejects(connect(url, auth), UnauthorizedError);
  assert.equal(auth.saved.callback.searchParams.get("iss"), url);

  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    authProvider: auth,
  });
  await transport.finishAuth(auth.saved.callback.searchParams.get("code"));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    ["ping"],
  );
  await client.close();
});

test("a wrong key gets no code", async () => {
  const url = await start();
  const auth = provider((u) => ownerApproves(u, "guess"));
  await assert.rejects(connect(url, auth), UnauthorizedError);
  assert.equal(auth.saved.callback, undefined);
});

test("the key works directly, and anything else gets the sign-in challenge", async () => {
  const url = await start();
  assert.equal((await listTools(url, { Authorization: `Bearer ${KEY}` })).status, 200);
  const refused = await listTools(url, { Authorization: "Bearer guess" });
  assert.equal(refused.status, 401);
  assert.match(
    refused.headers.get("www-authenticate"),
    /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
  assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
});

test("without publicUrl there is no sign-in, only the key", async () => {
  const url = await start({ signIn: false });
  assert.equal((await fetch(`${url}/.well-known/oauth-authorization-server`)).status, 404);
  assert.equal((await listTools(url, { Authorization: `Bearer ${KEY}` })).status, 200);
  const refused = await listTools(url, {});
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
  for (const signIn of [false, true]) {
    const url = await start({ signIn });
    assert.equal(await rawGet(url, "//["), "HTTP/1.1 400 Bad Request");
    assert.equal((await fetch(`${url}/elsewhere`)).status, 404, "still running");
  }
});

test("refuses a key short enough to guess", () => {
  assert.throws(
    () => serve({ name: "TEST_KEY", key: "short", tools, port: 0 }),
    /TEST_KEY needs at least 32/,
  );
});

test("a tool's answer carries its result, or only what the connector says about the error", async () => {
  class ApiError extends Error {}
  const describe = (error) => (error instanceof ApiError ? "HTTP 500" : undefined);
  const text = async (work) => (await toolAnswer("Bank", work, describe)).content[0].text;
  assert.equal(await text(() => ({ cents: 1 })), '{"cents":1}');
  assert.equal(await text(() => Promise.reject(new ApiError("account 1234567"))), "Bank: HTTP 500");
  assert.equal(await text(() => Promise.reject(new Error("account 1234567"))), "Bank: unavailable");
  assert.equal((await toolAnswer("Bank", () => 1, describe)).isError, undefined);
  assert.equal(
    (await toolAnswer("Bank", () => Promise.reject(new Error()), describe)).isError,
    true,
  );
});
