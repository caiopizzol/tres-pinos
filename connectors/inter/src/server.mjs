// MCP server that gives an agent the tools in tools.mjs, behind INTER_KEY.
import { createPrivateKey, timingSafeEqual, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readOnly } from "./guard.mjs";
import { certificateFetch, interClient } from "./inter.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = [
  "INTER_KEY",
  "INTER_CLIENT_ID",
  "INTER_CLIENT_SECRET",
  "INTER_CERT_PATH",
  "INTER_CERT_KEY_PATH",
].filter((n) => !env[n]);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);
// The key is the only thing between the internet and the owner's account, so it must be long enough not to guess.
if (env.INTER_KEY.length < 32)
  throw new Error("INTER_KEY needs at least 32 characters: openssl rand -hex 32");

// The container runs as uid 1000, which can't read a key owned by anyone else with mode 600.
const read = (path) => {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(
      error.code === "EACCES"
        ? `Can't read ${path}: give it to uid 1000 (see the README)`
        : `Can't read ${path}`,
    );
  }
};
const cert = read(env.INTER_CERT_PATH);
const key = read(env.INTER_CERT_KEY_PATH);
// A swapped or mismatched file would otherwise show up later as a vague TLS error.
try {
  if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) throw new Error();
} catch {
  throw new Error("INTER_CERT_PATH and INTER_CERT_KEY_PATH are not a matching certificate and key");
}

const inter = interClient(
  { clientId: env.INTER_CLIENT_ID, clientSecret: env.INTER_CLIENT_SECRET },
  readOnly(certificateFetch({ cert, key })),
);
const expectedAuth = Buffer.from(`Bearer ${env.INTER_KEY}`);

// Constant-time, so response timing doesn't reveal how much of a guessed key was right.
function hasKey(req) {
  const given = Buffer.from(req.headers.authorization ?? "");
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

async function handle(req, res) {
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();
  try {
    const server = buildServer(inter);
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

createServer((req, res) => {
  if (req.url !== "/mcp") return res.writeHead(404).end();
  if (!hasKey(req)) return res.writeHead(401).end();
  handle(req, res);
}).listen(Number(env.PORT ?? 8080));
