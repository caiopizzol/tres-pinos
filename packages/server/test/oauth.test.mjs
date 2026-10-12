// The OAuth server alone, run as each client would: register, approve with the connector's key, exchange the code,
// refresh. server.test.mjs runs the same sign-in through the MCP SDK's own client.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { allowedCallback, createOAuth } from "../src/oauth.mjs";

const KEY = "k".repeat(32);
const GROK = "cursor://anysphere.cursor-mcp/oauth/callback";
const CURSOR_WEB = "https://www.cursor.com/agents/mcp/oauth/callback";
const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");

// An OAuth server on a free port, with its own database and clock.
async function start(db = new DatabaseSync(":memory:")) {
  const clock = { now: Date.now() };
  let issuer;
  const server = createServer(async (req, res) => {
    if (!(await oauth.handle(req, res))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
  const oauth = createOAuth({
    issuer,
    db,
    name: "TEST_KEY",
    key: KEY,
    title: "Banco Fictício",
    reach: "Ele vai poder ler o saldo e o extrato.",
    now: () => clock.now,
  });
  after(() => server.close());
  return { issuer, oauth, clock, db };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", body, headers, redirect: "manual" });

async function register({ issuer }, callbacks = [GROK, "https://evil.example/cb"]) {
  const res = await post(
    `${issuer}/register`,
    JSON.stringify({ client_name: "Grok Bot", redirect_uris: callbacks }),
  );
  return { status: res.status, ...(await res.json()) };
}

const authorizeQuery = (client, callback = client.redirect_uris[0], extra = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  }).toString();

// Submits the consent form as the owner's browser would, and returns where the page sends it next.
async function approve({ issuer }, query, { key = KEY, decision = "allow", origin = issuer } = {}) {
  const res = await post(`${issuer}/authorize`, new URLSearchParams({ query, key, decision }), {
    Origin: origin,
  });
  const body = await res.text();
  const target = /content="0;url=([^"]+)"/.exec(body)?.[1];
  const decoded = target?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
  return { res, body, next: decoded && new URL(decoded) };
}

async function signIn(server, callback) {
  const client = await register(server, callback ? [callback] : undefined);
  const query = authorizeQuery(client);
  const page = await fetch(`${server.issuer}/authorize?${query}`);
  assert.equal(page.status, 200);
  const { next } = await approve(server, query);
  return { client, next, code: next.searchParams.get("code") };
}

const exchange = (server, fields) =>
  post(`${server.issuer}/token`, new URLSearchParams(fields), {
    "Content-Type": "application/x-www-form-urlencoded",
  });

test("allows only the hosted clients' callbacks and loopback ports", () => {
  for (const uri of [
    GROK,
    CURSOR_WEB,
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://claude.ai/api/mcp/auth_callback",
    "http://127.0.0.1:8787/cb",
    "http://localhost:3118/callback",
  ]) {
    assert.ok(allowedCallback(uri), uri);
  }
  for (const uri of [
    "https://evil.example/cb",
    "https://www.cursor.com.evil.com/agents/mcp/oauth/callback",
    "http://127.0.0.1.evil.com/cb",
    "http://user@127.0.0.1/cb",
    "not a url",
  ]) {
    assert.ok(!allowedCallback(uri), uri);
  }
});

test("a client signs in with the owner's key, uses its token, and refreshes once", async () => {
  const server = await start();
  const { client, next, code } = await signIn(server);
  assert.deepEqual(client.redirect_uris, [GROK]);
  assert.equal(`${next.protocol}//${next.host}${next.pathname}`, GROK);
  assert.deepEqual(
    [next.searchParams.get("state"), next.searchParams.get("iss")],
    ["xyz", server.issuer],
  );

  const fields = {
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: GROK,
    code_verifier: verifier,
    resource: `${server.issuer}/mcp`,
  };
  const tokens = await (await exchange(server, fields)).json();
  assert.ok(server.oauth.verify(`Bearer ${tokens.access_token}`));
  assert.ok(server.oauth.verify(`bearer ${tokens.access_token}`), "the scheme is case-insensitive");
  assert.ok(!server.oauth.verify(`Bearer ${tokens.refresh_token}`));
  assert.ok(!server.oauth.verify(`Bearer ${KEY}`), "the owner's key is not an OAuth token");
  assert.equal((await exchange(server, fields)).status, 400, "a code works once");

  const refresh = {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
  };
  const renewed = await (await exchange(server, refresh)).json();
  assert.ok(server.oauth.verify(`Bearer ${renewed.access_token}`));
  // Reusing the old refresh token means it leaked, so the whole grant ends, including the new token.
  const reuse = await exchange(server, refresh);
  assert.equal((await reuse.json()).error, "invalid_grant");
  assert.ok(!server.oauth.verify(`Bearer ${renewed.access_token}`));
});

test("only the owner's key approves, from the server's own page", async () => {
  const server = await start();
  const client = await register(server);
  const query = authorizeQuery(client);
  const page = await fetch(`${server.issuer}/authorize?${query}`);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("referrer-policy"), "same-origin");
  const html = await page.text();
  assert.match(html, /Ligar Grok Bot ao Banco Fictício\?/);
  assert.match(html, /Chave do conector \(TEST_KEY\)/);

  const wrong = await approve(server, query, { key: "guess" });
  assert.equal(wrong.res.status, 401);
  assert.match(wrong.body, /Chave errada/);
  assert.equal((await approve(server, query, { origin: "https://evil.example" })).res.status, 403);

  const denied = await approve(server, query, { decision: "deny" });
  assert.equal(denied.next.searchParams.get("error"), "access_denied");
  assert.equal(denied.next.searchParams.get("code"), null);
});

test("the answer to Allow is a page, not a redirect the browser's form-action would block", async () => {
  // Grok Bot signs in through Cursor's web callback, which redirects again (www.cursor.com to cursor.com).
  const server = await start();
  const client = await register(server, [CURSOR_WEB]);
  const query = authorizeQuery(client, CURSOR_WEB, { state: 'a"b<c' });
  const { res, next } = await approve(server, query);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(`${next.origin}${next.pathname}`, CURSOR_WEB);
  assert.ok(next.searchParams.get("code"));
  assert.equal(next.searchParams.get("state"), 'a"b<c');
});

test("refuses a wrong verifier, client, callback, resource, or expired code", async () => {
  const server = await start();
  const changes = [
    [{ code_verifier: "w".repeat(50) }, /code_verifier/],
    [{ client_id: "other" }, /another client/],
    [{ redirect_uri: "http://127.0.0.1:1/cb" }, /redirect_uri/],
    [{ resource: "https://elsewhere.example/mcp" }, /resource/],
  ];
  for (const [change, reason] of changes) {
    const { client, code } = await signIn(server);
    const res = await exchange(server, {
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: GROK,
      code_verifier: verifier,
      ...change,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error_description, reason);
  }
  const { client, code } = await signIn(server);
  server.clock.now += 6 * 60_000;
  const late = await exchange(server, {
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: GROK,
    code_verifier: verifier,
  });
  assert.equal((await late.json()).error, "invalid_grant");
});

test("a code stays single-use across a restart", async () => {
  const db = new DatabaseSync(":memory:");
  const first = await start(db);
  const { client, code } = await signIn(first);
  const fields = {
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: GROK,
    code_verifier: verifier,
  };
  // A second server on the same database, as after a restart.
  const second = await start(db);
  assert.equal((await exchange(second, fields)).status, 200);
  assert.equal((await exchange(first, fields)).status, 400);
});

test("a registration that isn't an object is refused, not a crash", async () => {
  const server = await start();
  for (const body of ["null", "[]", '"x"', "1"]) {
    const res = await post(`${server.issuer}/register`, body);
    assert.equal(res.status, 400, body);
  }
  assert.equal((await register(server)).status, 201, "still serving");
});

test("a burst of registrations keeps at most 1000 unused clients, and never one that signed in", async () => {
  const server = await start();
  const { client: signedIn, code } = await signIn(server);
  const fields = {
    grant_type: "authorization_code",
    code,
    client_id: signedIn.client_id,
    redirect_uri: GROK,
    code_verifier: verifier,
  };
  assert.equal((await exchange(server, fields)).status, 200);
  for (let i = 0; i < 1005; i++) await register(server);
  const count = (sql) => server.db.prepare(sql).get().n;
  assert.equal(
    count("select count(*) n from clients where id not in (select client_id from grants)"),
    1000,
  );
  assert.equal(count(`select count(*) n from clients where id = '${signedIn.client_id}'`), 1);
});

test("an unknown client or unregistered callback is answered here, never redirected", async () => {
  const server = await start();
  const unknown = await fetch(
    `${server.issuer}/authorize?client_id=nope&redirect_uri=${encodeURIComponent("https://evil.example")}`,
    { redirect: "manual" },
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get("location"), null);
  const client = await register(server);
  const other = await fetch(
    `${server.issuer}/authorize?${authorizeQuery(client, "http://127.0.0.1:9/cb")}`,
    { redirect: "manual" },
  );
  assert.equal(other.status, 400);
  assert.equal((await register(server, ["https://evil.example/cb"])).status, 400);
});

test("advertises what MCP clients need to find it", async () => {
  const server = await start();
  const resource = await (
    await fetch(`${server.issuer}/.well-known/oauth-protected-resource/mcp`)
  ).json();
  assert.deepEqual(
    [resource.resource, resource.authorization_servers],
    [`${server.issuer}/mcp`, [server.issuer]],
  );
  const meta = await (
    await fetch(`${server.issuer}/.well-known/oauth-authorization-server`)
  ).json();
  assert.equal(meta.issuer, server.issuer);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
});
