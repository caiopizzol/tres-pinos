// Approvals over HTTP, as the owner gives them: the page shows what the tool will do, only the approval key approves
// it, from the page's own origin, and the tool takes it once, before it expires.
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

const ask = (approvals, payload = "<DPS/>") =>
  approvals.request({
    title: "Emitir esta NFS-e?",
    summary: [["Tomador", "<b>ACME</b>"]],
    payload,
  });

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

test("the tool gets the payload only after the owner approves it with the key, and only once", async () => {
  const { approvals, url } = await start();
  const { approval, link } = ask(approvals);
  assert.equal(link, `${url}/approve/${approval}`);
  assert.throws(() => approvals.take(approval), /not approved it yet/);

  const shown = await fetch(link);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("x-frame-options"), "DENY");
  const page = await shown.text();
  assert.match(page, /Emitir esta NFS-e\?/);
  assert.match(page, /&#60;b&#62;ACME&#60;\/b&#62;/);
  assert.doesNotMatch(page, /<b>ACME/);

  assert.equal((await approve(link, { key: "b".repeat(32) })).status, 401);
  assert.equal((await approve(link, { key: HASH })).status, 401);
  assert.equal((await approve(link, { origin: "https://evil.example" })).status, 403);
  assert.throws(() => approvals.take(approval), /not approved it yet/);

  const approved = await approve(link);
  assert.equal(approved.status, 200);
  assert.match(await approved.text(), /Aprovado\. O agente pode seguir até/);
  assert.match(await (await fetch(link)).text(), /Cancelar a aprovação/);
  assert.equal(approvals.take(approval), "<DPS/>");
  assert.throws(() => approvals.take(approval), ApprovalError);
  assert.equal((await fetch(link)).status, 404);
});

test("a refusal, a cancelled approval, an expiry or an unknown id leaves nothing to take", async () => {
  const { approvals } = await start();
  const cancelled = ask(approvals);
  await approve(cancelled.link);
  assert.equal((await approve(cancelled.link, { decision: "refuse", key: "" })).status, 200);
  assert.throws(() => approvals.take(cancelled.approval), /No pending approval/);

  const refused = ask(approvals);
  assert.equal((await approve(refused.link, { decision: "refuse", key: "" })).status, 200);
  assert.throws(() => approvals.take(refused.approval), /No pending approval/);

  const late = ask(approvals);
  assert.equal((await approve(late.link)).status, 200);
  clock += 60 * 60_000;
  assert.throws(() => approvals.take(late.approval), /No pending approval/);
  assert.throws(() => approvals.take("made-up"), /No pending approval/);
});

test("five wrong keys drop the request, and an approval is good for ten minutes", async () => {
  const { approvals } = await start();
  const guessed = ask(approvals);
  for (let i = 0; i < 4; i++)
    assert.equal((await approve(guessed.link, { key: `${i}`.repeat(32) })).status, 401);
  assert.match(await (await approve(guessed.link, { key: "x".repeat(32) })).text(), /muitas vezes/);
  assert.equal((await approve(guessed.link)).status, 404);
  assert.throws(() => approvals.take(guessed.approval), /No pending approval/);

  const forgotten = ask(approvals);
  await approve(forgotten.link);
  clock += 10 * 60_000;
  assert.throws(() => approvals.take(forgotten.approval), /No pending approval/);
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
  const { link, approval } = ask(approvals);
  assert.equal((await approve(link, { key: short })).status, 401);
  assert.throws(() => approvals.take(approval), /not approved it yet/);
});

test("each request is its own approval: approving one doesn't approve another payload", async () => {
  const { approvals } = await start();
  const first = ask(approvals, "<DPS>1</DPS>");
  const second = ask(approvals, "<DPS>2</DPS>");
  await approve(first.link);
  assert.throws(() => approvals.take(second.approval), /not approved it yet/);
  assert.equal(approvals.take(first.approval), "<DPS>1</DPS>");
});

test("the link and the form's origin are the owner's setting, never the request's", async () => {
  const { approvals, url } = await start();
  const { link } = ask(approvals);
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
});
