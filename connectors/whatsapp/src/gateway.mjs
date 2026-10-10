// MCP server that gives an agent the tools in tools.mjs, behind a bearer token or Cloudflare Access.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { buildServer, SESSIONS, waha } from "./tools.mjs";

const { GATEWAY_TOKEN, ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL, NTFY_TOPIC } = process.env;
if (!GATEWAY_TOKEN) throw new Error("GATEWAY_TOKEN is required");
const expectedAuth = Buffer.from(`Bearer ${GATEWAY_TOKEN}`);

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

// Full access, for agents that can send the bearer token. Published only on the host's loopback.
createServer((req, res) => {
  if (req.url !== "/mcp") return res.writeHead(404).end();
  if (!hasToken(req)) return res.writeHead(401).end();
  handle(req, res);
}).listen(8080);

// Full access through Cloudflare Access, for clients that sign in with OAuth. The tunnel publishes this one.
// Access handles the login; this checks Access's signed header so nothing else on the network gets in.
if (ACCESS_TEAM_DOMAIN && ACCESS_AUD && OWNER_EMAIL) {
  const keys = createRemoteJWKSet(new URL(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  const isOwner = async (req) => {
    try {
      const token = req.headers["cf-access-jwt-assertion"] ?? "";
      const { payload } = await jwtVerify(token, keys, { issuer: ACCESS_TEAM_DOMAIN, audience: ACCESS_AUD });
      return payload.email === OWNER_EMAIL;
    } catch {
      return false;
    }
  };
  createServer(async (req, res) => {
    if (req.url !== "/mcp") return res.writeHead(404).end();
    if (!(await isOwner(req))) return res.writeHead(403).end();
    handle(req, res);
  }).listen(8082);
}

// Pushes a phone notification when a WhatsApp session stops working, and again when it recovers.
// Not through WhatsApp: the session that's down may be the one that would send it.
// It alerts after two failed checks in a row, so a session restarting for a few seconds doesn't.
if (NTFY_TOPIC) {
  const state = new Map(); // session -> { misses, alerted }
  const notify = (title, priority) =>
    fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: { Title: title, Priority: priority },
      body: title,
      signal: AbortSignal.timeout(10_000),
    }).then((res) => res.ok, () => false);

  const check = async () => {
    for (const session of SESSIONS) {
      const status = await waha(`/api/sessions/${session}`).then((s) => s.status, () => "UNREACHABLE");
      const s = state.get(session) ?? { misses: 0, alerted: false };
      s.misses = status === "WORKING" ? 0 : s.misses + 1;
      // Only remember an alert once ntfy accepted it, so a failed send is retried next check.
      if (s.misses >= 2 && !s.alerted) s.alerted = await notify(`WhatsApp ${session} is ${status}`, "high");
      if (s.misses === 0 && s.alerted) s.alerted = !(await notify(`WhatsApp ${session} is working again`, "default"));
      state.set(session, s);
    }
  };
  setInterval(check, Number(process.env.CHECK_INTERVAL_MS ?? 5 * 60_000));
}
