// Serves a connector's MCP tools on /mcp, to requests that carry its key. With `publicUrl`, remote clients that
// reach it there can also sign in with OAuth instead (see oauth.mjs).
import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createOAuth } from "./oauth.mjs";

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
      if (new URL(req.url, "http://x").pathname !== "/mcp") return res.writeHead(404).end();
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
