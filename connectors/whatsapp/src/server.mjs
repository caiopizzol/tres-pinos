// MCP server that gives an agent the tools in tools.mjs, behind WHATSAPP_KEY. With PUBLIC_URL, clients that
// reach it there can also sign in with OAuth instead (see oauth.mjs).
import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createOAuth } from "./oauth.mjs";
import { buildServer } from "./tools.mjs";

// The key is the only thing between the internet and the owner's chats, so it must be long enough not to guess.
// PORT is for tests; the image always listens on 8080.
const { WHATSAPP_KEY, PUBLIC_URL, DATA_DIR = "/data", PORT = 8080 } = process.env;
if (!WHATSAPP_KEY || WHATSAPP_KEY.length < 32)
  throw new Error("WHATSAPP_KEY needs at least 32 characters: openssl rand -hex 32");
const expectedAuth = Buffer.from(`Bearer ${WHATSAPP_KEY}`);

// Constant-time, so response timing doesn't reveal how much of a guessed key was right.
function hasKey(req) {
  const given = Buffer.from(req.headers.authorization ?? "");
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

let oauth = null;
if (PUBLIC_URL) {
  mkdirSync(DATA_DIR, { recursive: true });
  const issuer = new URL(PUBLIC_URL).origin;
  oauth = createOAuth({
    issuer,
    db: new DatabaseSync(`${DATA_DIR}/oauth.sqlite`),
    key: WHATSAPP_KEY,
  });
}

async function handle(req, res) {
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();

  try {
    const server = buildServer();
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

createServer(async (req, res) => {
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
}).listen(Number(PORT));
