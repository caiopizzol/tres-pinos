// MCP server that gives an agent the tools in tools.mjs, behind SICOOB_KEY.
import { createPrivateKey, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readOnly } from "./guard.mjs";
import { certificateFetch } from "./sicoob.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = ["SICOOB_KEY", "SICOOB_CLIENT_ID", "SICOOB_ACCOUNT", "SICOOB_CERT_PATH", "SICOOB_CERT_KEY_PATH", "SICOOB_CERT_PASSWORD"].filter((n) => !env[n]);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);
// The key is the only thing between the internet and the owner's account, so it must be long enough not to guess.
if (env.SICOOB_KEY.length < 32) throw new Error("SICOOB_KEY needs at least 32 characters: openssl rand -hex 32");
if (!/^\d{1,14}$/.test(env.SICOOB_ACCOUNT)) throw new Error("SICOOB_ACCOUNT is the account number, digits only");

// The container runs as uid 1000, which can't read a key owned by anyone else with mode 600.
const read = (path) => {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(error.code === "EACCES" ? `Can't read ${path}: give it to uid 1000 or make it readable` : `Can't read ${path}`);
  }
};
const cert = read(env.SICOOB_CERT_PATH);
const key = read(env.SICOOB_CERT_KEY_PATH);
// A wrong password would otherwise show up later as a vague TLS error.
try {
  createPrivateKey({ key, passphrase: env.SICOOB_CERT_PASSWORD });
} catch {
  throw new Error("SICOOB_CERT_PASSWORD does not open SICOOB_CERT_KEY_PATH");
}

const config = { clientId: env.SICOOB_CLIENT_ID, account: env.SICOOB_ACCOUNT };
const fetch = readOnly(certificateFetch({ cert, key, passphrase: env.SICOOB_CERT_PASSWORD }));
const expectedAuth = Buffer.from(`Bearer ${env.SICOOB_KEY}`);

// Constant-time, so response timing doesn't reveal how much of a guessed key was right.
function hasKey(req) {
  const given = Buffer.from(req.headers.authorization ?? "");
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

async function handle(req, res) {
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();
  try {
    const server = buildServer(config, fetch);
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
  if (!hasKey(req)) return res.writeHead(401).end();
  handle(req, res);
}).listen(Number(env.PORT ?? 8080));
