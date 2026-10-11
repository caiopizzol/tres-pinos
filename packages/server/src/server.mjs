// Serves a connector's MCP tools on /mcp, only to requests that carry its key.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// `name` is the key's setting, such as SICOOB_KEY; `tools` builds a fresh McpServer for each request.
export function serve({ name, key, tools, port }) {
  // The key is the only thing between the internet and the owner's account, so it must be long enough not to guess.
  if (key.length < 32)
    throw new Error(`${name} needs at least 32 characters: openssl rand -hex 32`);
  const expectedAuth = Buffer.from(`Bearer ${key}`);

  // Constant-time, so response timing doesn't reveal how much of a guessed key was right.
  function hasKey(req) {
    const given = Buffer.from(req.headers.authorization ?? "");
    return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
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

  return createServer((req, res) => {
    if (req.url !== "/mcp") return res.writeHead(404).end();
    if (!hasKey(req)) return res.writeHead(401).end();
    handle(req, res);
  }).listen(port);
}
