// Approvals over HTTP, as the owner gives them: the page shows what the work will do, only the approval key approves
// it, from the page's own origin, and approving runs the work once, before the request expires.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { read } from "../src/page.mjs";
import { ApprovalError, createApprovals } from "../src/server.mjs";

const APPROVAL_KEY = "a".repeat(32);
const HASH = createHash("sha256").update(APPROVAL_KEY).digest("hex");
let clock = 0;

async function start() {
  let approvals;
  const server = createServer(async (req, res) => {
    if (!(await approvals.handle(req, res))) res.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  approvals = createApprovals({ name: "TEST_APPROVAL_HASH", hash: HASH, url, now: () => clock });
  return { approvals, url };
}

const approve = (link, { key = APPROVAL_KEY, decision = "approve", origin } = {}) =>
  fetch(link, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin ?? new URL(link).origin,
    },
    body: new URLSearchParams({ key, decision }),
  });

class ApiError extends Error {}

// A request whose work counts its runs, and returns `result` or throws it when it is an Error.
function ask(approvals, result = { number: "7" }) {
  const runs = [];
  const asked = approvals.request({
    title: "Emitir esta NFS-e?",
    summary: [["Tomador", "<b>ACME</b>"]],
    button: "Aprovar e emitir",
    run: async () => {
      runs.push(1);
      if (result instanceof Error) throw result;
      return result;
    },
    report: (r) => [["Número", r.number]],
    describe: (error) => (error instanceof ApiError ? "HTTP 500" : undefined),
  });
  return { ...asked, runs };
}

test("needs the SHA-256 of the approval key, not the key", () => {
  for (const hash of [undefined, APPROVAL_KEY, HASH.slice(1)])
    assert.throws(
      () => createApprovals({ name: "TEST_APPROVAL_HASH", hash, url: "http://127.0.0.1:1" }),
      /TEST_APPROVAL_HASH must be the SHA-256/,
    );
});

test("the owner types the key only over https, or on this machine", () => {
  const make = (url) => createApprovals({ name: "TEST_APPROVAL_HASH", hash: HASH, url });
  assert.throws(() => make("http://nfse.example.com"), /https address/);
  make("https://nfse.example.com");
  make("http://localhost:3014");
});

test("a form's text survives a character split across chunks", async () => {
  const bytes = Buffer.from("decision=refuse&nome=Ação");
  const at = bytes.indexOf(0xc3) + 1;
  assert.equal(
    await read([bytes.subarray(0, at), bytes.subarray(at)]),
    "decision=refuse&nome=Ação",
  );
  await assert.rejects(read([Buffer.alloc(9000)]), /too large/);
});

test("approving with the key runs the work once and shows its result, which the agent reads", async () => {
  const { approvals, url } = await start();
  const { approval, link, runs } = ask(approvals);
  assert.equal(link, `${url}/approve/${approval}`);
  assert.deepEqual(approvals.status(approval), {
    status: "pending",
    result: undefined,
    error: undefined,
  });

  const shown = await fetch(link);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("x-frame-options"), "DENY");
  const page = await shown.text();
  assert.match(page, /Emitir esta NFS-e\?/);
  assert.match(page, /&#60;b&#62;ACME&#60;\/b&#62;/);
  assert.doesNotMatch(page, /<b>ACME/);
  assert.match(page, />Aprovar e emitir</);

  assert.equal((await approve(link, { key: "b".repeat(32) })).status, 401);
  assert.equal((await approve(link, { key: HASH })).status, 401);
  assert.equal((await approve(link, { origin: "https://evil.example" })).status, 403);
  assert.equal(runs.length, 0);
  assert.equal(approvals.status(approval).status, "pending");

  const approved = await approve(link);
  assert.equal(approved.status, 200);
  assert.match(await approved.text(), /Feito[\s\S]*Número[\s\S]*7/);
  assert.deepEqual(approvals.status(approval), {
    status: "done",
    result: { number: "7" },
    error: undefined,
  });

  // Approving again, or reloading, shows the same result and runs nothing.
  assert.match(await (await approve(link)).text(), /Feito/);
  assert.match(await (await fetch(link)).text(), /Feito/);
  assert.equal(runs.length, 1);
});

test("a failure shows only what describe says, and nothing runs again", async () => {
  const { approvals } = await start();
  const known = ask(approvals, new ApiError("account 1234567"));
  const page = await (await approve(known.link)).text();
  assert.match(page, /Não deu certo[\s\S]*HTTP 500/);
  assert.doesNotMatch(page, /1234567/);
  assert.deepEqual(approvals.status(known.approval), {
    status: "failed",
    result: undefined,
    error: "HTTP 500",
  });
  await approve(known.link);
  assert.equal(known.runs.length, 1);

  const unknown = ask(approvals, new Error("account 1234567"));
  await approve(unknown.link);
  assert.equal(approvals.status(unknown.approval).error, "unavailable");
});

test("a refusal runs nothing, and an expiry or an unknown id leaves nothing to read", async () => {
  const { approvals } = await start();
  const refused = ask(approvals);
  assert.match(
    await (await approve(refused.link, { decision: "refuse", key: "" })).text(),
    /Recusado/,
  );
  assert.equal(approvals.status(refused.approval).status, "refused");
  assert.match(await (await approve(refused.link)).text(), /Recusado/);
  assert.equal(refused.runs.length, 0);

  const late = ask(approvals);
  clock += 60 * 60_000;
  assert.throws(() => approvals.status(late.approval), /No approval with this id/);
  assert.equal((await approve(late.link)).status, 404);
  assert.equal(late.runs.length, 0);
  assert.throws(() => approvals.status("made-up"), ApprovalError);
});

test("five wrong keys drop the request", async () => {
  const { approvals } = await start();
  const guessed = ask(approvals);
  for (let i = 0; i < 4; i++)
    assert.equal((await approve(guessed.link, { key: `${i}`.repeat(32) })).status, 401);
  assert.match(await (await approve(guessed.link, { key: "x".repeat(32) })).text(), /muitas vezes/);
  assert.equal((await approve(guessed.link)).status, 404);
  assert.throws(() => approvals.status(guessed.approval), /No approval with this id/);
  assert.equal(guessed.runs.length, 0);
});

test("a key shorter than 32 characters never approves, even with the matching hash", async () => {
  const short = "short";
  let approvals;
  const server = createServer(async (req, res) => {
    if (!(await approvals.handle(req, res))) res.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  after(() => server.close());
  approvals = createApprovals({
    name: "TEST_APPROVAL_HASH",
    hash: createHash("sha256").update(short).digest("hex"),
    url: `http://127.0.0.1:${server.address().port}`,
  });
  const { link, runs } = ask(approvals);
  assert.equal((await approve(link, { key: short })).status, 401);
  assert.equal(runs.length, 0);
});

test("two approvals of the same request at once run the work once", async () => {
  const { approvals, url } = await start();
  const { link, runs } = ask(approvals);
  // Straight to the handler, so both forms are read before either decides: over HTTP they rarely overlap.
  const post = () => {
    const req = Object.assign(
      [new URLSearchParams({ key: APPROVAL_KEY, decision: "approve" }).toString()],
      {
        url: new URL(link).pathname,
        method: "POST",
        headers: { origin: url },
      },
    );
    const res = { writeHead: () => res, end: () => {} };
    return approvals.handle(req, res);
  };
  await Promise.all([post(), post()]);
  assert.equal(runs.length, 1);
});

test("what the owner approved outlives its expiry and a hundred newer requests, which push out only open ones", async () => {
  const { approvals } = await start();
  let started;
  let finish;
  const running = new Promise((resolve) => (started = resolve));
  const { approval, link } = approvals.request({
    title: "Pagar este boleto?",
    summary: [],
    button: "Aprovar e pagar",
    run: () => (started(), new Promise((resolve) => (finish = resolve))),
    report: (r) => [["Nº no Sicoob", r.id]],
    describe: () => undefined,
  });
  clock += 60 * 60_000 - 1;
  const approved = approve(link);
  // Settles either way, so approving without running fails here instead of waiting forever.
  await Promise.race([running, approved]);
  assert.ok(finish, "approving ran the work");
  clock += 2;
  for (let i = 0; i < 100; i++) ask(approvals);
  // Ended before the checks, so a failing check doesn't leave the owner's request open.
  finish({ id: 1000 });
  assert.match(await (await approved).text(), /Feito/);

  const older = ask(approvals);
  for (let i = 0; i < 100; i++) ask(approvals);
  assert.throws(() => approvals.status(older.approval), /No approval with this id/);
  assert.deepEqual(approvals.status(approval), {
    status: "done",
    result: { id: 1000 },
    error: undefined,
  });
  assert.match(await (await fetch(link)).text(), /Feito/);
});

test("each request is its own approval: approving one runs no other", async () => {
  const { approvals } = await start();
  const first = ask(approvals);
  const second = ask(approvals);
  await approve(first.link);
  assert.deepEqual([first.runs.length, second.runs.length], [1, 0]);
  assert.equal(approvals.status(second.approval).status, "pending");
});

test("the link and the form's origin are the owner's setting, never the request's", async () => {
  const { approvals, url } = await start();
  const { link, runs } = ask(approvals);
  assert.ok(link.startsWith(`${url}/approve/`));
  const elsewhere = await fetch(link, {
    method: "POST",
    headers: {
      Host: "127.0.0.1:4444",
      Origin: "http://127.0.0.1:4444",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ key: APPROVAL_KEY, decision: "approve" }),
  });
  assert.equal(elsewhere.status, 403);
  assert.equal(runs.length, 0);
});
