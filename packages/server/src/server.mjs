// Serves a connector's MCP tools on /mcp, to requests that carry its key. With `publicUrl`, remote clients that
// reach it there can also sign in with OAuth instead (see oauth.mjs).
import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createOAuth } from "./oauth.mjs";

// The Três Pinos icon, public at /favicon.ico and /icon.png, for apps that show a connector's logo.
const ICONS = {
  "/favicon.ico": ["image/x-icon", readFileSync(new URL("icon/favicon.ico", import.meta.url))],
  "/icon.png": ["image/png", readFileSync(new URL("icon/icon.png", import.meta.url))],
};

// The icon as MCP describes it, for a connector's McpServer; `publicUrl` makes it an address apps can fetch.
export const icons = (publicUrl) =>
  publicUrl
    ? [{ src: new URL("/icon.png", publicUrl).href, mimeType: "image/png", sizes: ["192x192"] }]
    : undefined;

// `name` is the key's setting, such as SICOOB_KEY; `tools` builds a fresh McpServer for each request.
// `consent` is the connector's title and what it reaches, for the sign-in page; `dataDir` keeps the sign-ins.
export function serve({ name, key, tools, port, publicUrl, dataDir = "/data", consent }) {
  // The key is the only thing between the internet and the owner's account, so it must be long enough not to guess.
  if (key.length < 32)
    throw new Error(`${name} needs at least 32 characters: openssl rand -hex 32`);
  const expectedAuth = Buffer.from(`Bearer ${key}`);

  // Constant-time, so response timing doesn't reveal how much of a guessed key was right.
  function hasKey(req) {
    const given = Buffer.from(req.headers.authorization ?? "");
    return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
  }

  let oauth = null;
  if (publicUrl) {
    mkdirSync(dataDir, { recursive: true });
    oauth = createOAuth({
      issuer: new URL(publicUrl).origin,
      db: new DatabaseSync(`${dataDir}/oauth.sqlite`),
      name,
      key,
      ...consent,
    });
  }

  async function handle(req, res) {
    if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();
    try {
      const server = tools();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => server.close().catch(console.error));
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  return createServer(async (req, res) => {
    // A malformed path, such as //[, makes URL parsing throw; answer it here instead of crashing the server.
    try {
      if (oauth && (await oauth.handle(req, res))) return;
      const path = new URL(req.url, "http://x").pathname;
      if (ICONS[path] && req.method === "GET") {
        const [type, body] = ICONS[path];
        return res
          .writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" })
          .end(body);
      }
      if (path !== "/mcp") return res.writeHead(404).end();
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(400).end();
      return;
    }
    if (hasKey(req) || oauth?.verify(req.headers.authorization)) return handle(req, res);
    if (oauth) return oauth.challenge(res);
    res.writeHead(401).end();
  }).listen(port);
}

// The answer to a tool call: `work`'s result as JSON. When it fails, the answer is `label` and only what
// `describe` says about the error, such as an HTTP status; any other failure is "unavailable", so the API's message
// text never reaches the agent.
export async function toolAnswer(label, work, describe) {
  try {
    const data = await work();
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `${label}: ${describe(error) ?? "unavailable"}` }],
    };
  }
}
