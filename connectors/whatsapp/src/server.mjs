// MCP server that gives an agent the tools in tools.mjs, behind a bearer token.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./tools.mjs";

// The key is the only thing between the internet and the owner's chats, so it must be long enough not to guess.
// PORT is for tests; the image always listens on 8080.
const { WHATSAPP_KEY, PORT = 8080 } = process.env;
if (!WHATSAPP_KEY || WHATSAPP_KEY.length < 32) throw new Error("WHATSAPP_KEY needs at least 32 characters: openssl rand -hex 32");
const expectedAuth = Buffer.from(`Bearer ${WHATSAPP_KEY}`);

// Constant-time, so response timing doesn't reveal how much of a guessed token was right.
function hasToken(req) {
  const given = Buffer.from(req.headers.authorization ?? "");
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

async function handle(req, res) {
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();

  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => server.close().catch(console.error));
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end();
  }
}

createServer((req, res) => {
  if (req.url !== "/mcp") return res.writeHead(404).end();
  if (!hasToken(req)) return res.writeHead(401).end();
  handle(req, res);
}).listen(Number(PORT));
