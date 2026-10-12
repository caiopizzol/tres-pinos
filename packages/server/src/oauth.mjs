// A small OAuth 2.1 server for one owner, so remote MCP clients (ChatGPT, Claude, Grok Bot) can sign in.
// The owner approves each client on a page that asks for the connector's key, and the client gets its own
// tokens for /mcp, which expire and can be revoked without changing the key.
// https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CODE_MS = 5 * 60_000;
const ACCESS_MS = 60 * 60_000;
const REFRESH_MS = 30 * 86_400_000;
const SCOPE = "mcp";

// The hosted clients' callbacks: ChatGPT, Claude, and Grok Bot, which signs in through Cursor's.
const CALLBACKS = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

// Desktop and terminal clients, such as Codex and Claude Code, listen on a loopback port of their choosing (RFC 8252).
export function allowedCallback(uri) {
  if (CALLBACKS.includes(uri)) return true;
  try {
    const url = new URL(uri);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const sha256 = (value) => createHash("sha256").update(value).digest("base64url");
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function read(req, limit = 8192) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error("Request too large");
  }
  return text;
}

const send = (res, status, body, headers = {}) =>
  res.writeHead(status, { "Cache-Control": "no-store", ...headers }).end(body);
const json = (res, value, status = 200) =>
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json" });
const oauthError = (res, error, description) =>
  json(res, { error, error_description: description }, 400);

const pageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  // Under no-referrer, browsers send "Origin: null" with the form, which the origin check refuses.
  "Referrer-Policy": "same-origin",
};

// `title` and `reach` describe the connector on the consent page; `name` is its key's setting, such as INTER_KEY.
export function createOAuth({
  issuer,
  db,
  name: keyName,
  key,
  title,
  reach,
  now = () => Date.now(),
}) {
  const resource = `${issuer}/mcp`;
  const expected = Buffer.from(key);
  const isOwner = (given) => {
    const b = Buffer.from(given ?? "");
    return b.length === expected.length && timingSafeEqual(b, expected);
  };

  db.exec(`
    create table if not exists clients (id text primary key, name text not null, callbacks text not null, created_at integer not null);
    create table if not exists codes (hash text primary key, request text not null, expires_at integer not null);
    create table if not exists grants (id text primary key, client_id text not null);
    create table if not exists tokens (hash text primary key, grant_id text not null, kind text not null, expires_at integer not null, used integer not null default 0);
  `);

  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    // ChatGPT uses its stable callback only when every authorization response names the issuer (RFC 9207).
    authorization_response_iss_parameter_supported: true,
  };
  const protectedResource = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };

  async function register(req, res) {
    let meta;
    try {
      meta = JSON.parse(await read(req, 4096));
    } catch {
      return oauthError(
        res,
        "invalid_client_metadata",
        "Send the registration as JSON, under 4 KB",
      );
    }
    // A client may list callbacks this server can't use (Grok Bot also sends https ones); keep the allowed ones.
    const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.slice(0, 5) : [];
    const callbacks = uris.filter((u) => typeof u === "string" && allowedCallback(u));
    if (!callbacks.length)
      return oauthError(res, "invalid_redirect_uri", "None of the redirect_uris is allowed");
    // Registration is open to anyone, so clients that never signed in are dropped after a day.
    db.prepare(
      "delete from clients where created_at < ? and id not in (select client_id from grants)",
    ).run(now() - 86_400_000);
    const id = random(16);
    const name =
      typeof meta.client_name === "string" && meta.client_name.trim()
        ? meta.client_name.slice(0, 100)
        : "Cliente MCP";
    db.prepare("insert into clients values (?, ?, ?, ?)").run(
      id,
      name,
      JSON.stringify(callbacks),
      now(),
    );
    json(
      res,
      {
        client_id: id,
        client_id_issued_at: Math.floor(now() / 1000),
        client_name: name,
        redirect_uris: callbacks,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  }

  // The authorization request in params, or why it can't go on. Until the callback is known to be the
  // client's own, errors are shown here; after that they go back to the client.
  function readRequest(params) {
    const client = db
      .prepare("select name, callbacks from clients where id = ?")
      .get(params.get("client_id") ?? "");
    if (!client) return { error: "Cliente desconhecido. Adicione o conector de novo no app." };
    const callback = params.get("redirect_uri") ?? "";
    if (!JSON.parse(client.callbacks).includes(callback))
      return { error: "Este endereço de retorno não foi registrado pelo cliente." };
    const state = params.get("state");
    if (params.get("response_type") !== "code")
      return { callback, state, redirectError: "unsupported_response_type" };
    const challenge = params.get("code_challenge") ?? "";
    if (params.get("code_challenge_method") !== "S256" || !/^[\w-]{43}$/.test(challenge))
      return { callback, state, redirectError: "invalid_request" };
    if ((params.get("resource") ?? resource) !== resource)
      return { callback, state, redirectError: "invalid_target" };
    return {
      name: client.name,
      callback,
      state,
      request: {
        client_id: params.get("client_id"),
        redirect_uri: callback,
        code_challenge: challenge,
      },
    };
  }

  function back(callback, params) {
    const url = new URL(callback);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    url.searchParams.set("iss", issuer);
    return url.href;
  }

  // After the form, a page that moves on to the callback instead of a redirect: form-action applies to every
  // redirect after a form post, including the callback's own (www.cursor.com sends on to cursor.com).
  const continueTo = (res, url) =>
    send(
      res,
      200,
      `<!doctype html><meta http-equiv="refresh" content="0;url=${escape(url)}"><a href="${escape(url)}">Continuar</a>`,
      {
        ...pageHeaders,
        "Referrer-Policy": "no-referrer",
      },
    );

  function consent(res, query, name, callback, wrong = false) {
    const style =
      "font:16px/1.5 system-ui;color:#1D1D1F;background:#F6F5F1;max-width:28rem;margin:4rem auto;padding:0 1rem";
    const field =
      "display:block;width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem;border:1px solid #E2DFD6;border-radius:8px;font:inherit";
    const button =
      "padding:.5rem .9rem;border-radius:10px;border:1px solid #1D1D1F;font:inherit;font-weight:600";
    send(
      res,
      wrong ? 401 : 200,
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Três Pinos</title><body style="${style}">
<h1 style="font-size:1.25rem">Ligar ${escape(name)} ao ${escape(title)}?</h1>
<p>${escape(reach)}</p>
<p style="color:#6A675F;font-size:.9rem">Volta para ${escape(new URL(callback).origin)}</p>
<form method="post" action="/authorize"><input type="hidden" name="query" value="${escape(query)}">
<label>Chave do conector (${escape(keyName)})<input name="key" type="password" required autocomplete="current-password" style="${field}"></label>
${wrong ? '<p style="color:#B42318">Chave errada.</p>' : ""}
<button name="decision" value="allow" style="${button};background:#1D1D1F;color:#F7C831">Permitir</button>
<button name="decision" value="deny" formnovalidate style="${button};background:none">Recusar</button></form>`,
      pageHeaders,
    );
  }

  async function authorize(req, res) {
    if (req.method === "GET") {
      const query = new URL(req.url, issuer).search.slice(1);
      const { error, redirectError, name, callback, state } = readRequest(
        new URLSearchParams(query),
      );
      if (error) return send(res, 400, error, { "Content-Type": "text/plain; charset=utf-8" });
      if (redirectError)
        return send(res, 302, "", { Location: back(callback, { error: redirectError, state }) });
      return consent(res, query, name, callback);
    }
    if (req.method !== "POST") return send(res, 405, "");
    if (req.headers.origin !== issuer) return send(res, 403, "Origem errada.");
    const form = new URLSearchParams(await read(req));
    const query = form.get("query") ?? "";
    const { error, redirectError, name, callback, state, request } = readRequest(
      new URLSearchParams(query),
    );
    if (error) return send(res, 400, error, { "Content-Type": "text/plain; charset=utf-8" });
    if (redirectError) return continueTo(res, back(callback, { error: redirectError, state }));
    if (form.get("decision") !== "allow")
      return continueTo(res, back(callback, { error: "access_denied", state }));
    if (!isOwner(form.get("key"))) return consent(res, query, name, callback, true);
    const code = random();
    db.prepare("insert into codes values (?, ?, ?)").run(
      sha256(code),
      JSON.stringify(request),
      now() + CODE_MS,
    );
    continueTo(res, back(callback, { code, state }));
  }

  function issue(res, grantId) {
    db.prepare("delete from codes where expires_at < ?").run(now());
    db.prepare("delete from tokens where expires_at < ?").run(now());
    const access = random();
    const refresh = random();
    const insert = db.prepare(
      "insert into tokens (hash, grant_id, kind, expires_at) values (?, ?, ?, ?)",
    );
    insert.run(sha256(access), grantId, "access", now() + ACCESS_MS);
    insert.run(sha256(refresh), grantId, "refresh", now() + REFRESH_MS);
    json(res, {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_MS / 1000,
      refresh_token: refresh,
      scope: SCOPE,
    });
  }

  function revokeGrant(grantId) {
    db.prepare("delete from tokens where grant_id = ?").run(grantId);
    db.prepare("delete from grants where id = ?").run(grantId);
  }

  async function token(req, res) {
    const form = new URLSearchParams(await read(req));
    const sameClient = (id) => form.get("client_id") === id;

    if (form.get("grant_type") === "authorization_code") {
      // Taken and removed together, so a code works once, across restarts too.
      const code = db
        .prepare("delete from codes where hash = ? returning request, expires_at")
        .get(sha256(form.get("code") ?? ""));
      if (!code || code.expires_at <= now())
        return oauthError(res, "invalid_grant", "The code is invalid or expired");
      const request = JSON.parse(code.request);
      if (!sameClient(request.client_id))
        return oauthError(res, "invalid_grant", "The code was issued to another client");
      if ((form.get("redirect_uri") ?? request.redirect_uri) !== request.redirect_uri)
        return oauthError(res, "invalid_grant", "The redirect_uri does not match");
      if ((form.get("resource") ?? resource) !== resource)
        return oauthError(res, "invalid_target", `The resource is ${resource}`);
      if (sha256(form.get("code_verifier") ?? "") !== request.code_challenge)
        return oauthError(res, "invalid_grant", "The code_verifier does not match");
      const grantId = random(16);
      db.prepare("insert into grants values (?, ?)").run(grantId, request.client_id);
      return issue(res, grantId);
    }

    if (form.get("grant_type") === "refresh_token") {
      const hash = sha256(form.get("refresh_token") ?? "");
      const row = db
        .prepare(
          "select t.grant_id, t.expires_at, g.client_id from tokens t join grants g on g.id = t.grant_id where t.hash = ? and t.kind = 'refresh'",
        )
        .get(hash);
      if (!row || row.expires_at <= now())
        return oauthError(res, "invalid_grant", "The refresh token is invalid");
      if (!sameClient(row.client_id))
        return oauthError(res, "invalid_grant", "The refresh token belongs to another client");
      // Rotation: a refresh token works once. Seeing it again means it leaked, so the whole grant ends.
      if (
        db.prepare("update tokens set used = 1 where hash = ? and used = 0").run(hash).changes !== 1
      ) {
        revokeGrant(row.grant_id);
        return oauthError(
          res,
          "invalid_grant",
          "The refresh token was already used; sign in again",
        );
      }
      return issue(res, row.grant_id);
    }

    oauthError(res, "unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  async function revoke(req, res) {
    const row = db
      .prepare("select grant_id from tokens where hash = ?")
      .get(sha256(new URLSearchParams(await read(req)).get("token") ?? ""));
    if (row) revokeGrant(row.grant_id);
    send(res, 200, "");
  }

  // Whether the Authorization header carries a live access token from this server.
  function verify(authorization) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
    if (!token) return false;
    const row = db
      .prepare(
        "select t.expires_at from tokens t join grants g on g.id = t.grant_id where t.hash = ? and t.kind = 'access'",
      )
      .get(sha256(token));
    return Boolean(row && row.expires_at > now());
  }

  // The 401 that starts sign-in: it tells the client where to read how.
  const challenge = (res) =>
    send(res, 401, "", {
      "WWW-Authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
    });

  // Answers the OAuth routes, and returns false for anything else.
  async function handle(req, res) {
    const { pathname } = new URL(req.url, issuer);
    const post = req.method === "POST";
    if (pathname === "/.well-known/oauth-authorization-server") json(res, metadata);
    else if (
      pathname === "/.well-known/oauth-protected-resource/mcp" ||
      pathname === "/.well-known/oauth-protected-resource"
    )
      json(res, protectedResource);
    else if (pathname === "/register" && post) await register(req, res);
    else if (pathname === "/authorize") await authorize(req, res);
    else if (pathname === "/token" && post) await token(req, res);
    else if (pathname === "/revoke" && post) await revoke(req, res);
    else return false;
    return true;
  }

  return { handle, verify, challenge };
}
