// The tools against a fake WAHA, through a real MCP client. Needs no WhatsApp session or network.
// Each connector runs in its own process, because the settings are read once, from the environment.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fakeWaha, message } from "./fake-waha.mjs";

const SAVED = "5511900000001@c.us";
const STRANGER = "5511900000002@c.us";
const GONE = "5511900000003@c.us";
const GROUP = "120363000000000001@g.us";
// A saved contact and a stranger whom WhatsApp addresses by hidden ids, one it can't map, and one
// whose lookup fails.
const SAVED_LID = "100000000000001@lid";
const STRANGER_LID = "100000000000002@lid";
const UNKNOWN_LID = "100000000000003@lid";
const FAILING_LID = "100000000000004@lid";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const messages = {
  [SAVED]: [
    message({ id: "d1", chat: SAVED, body: "hi" }),
    message({ id: "d2", chat: SAVED, fromMe: true, body: "hello" }),
    message({ id: "d3", chat: SAVED, mimetype: "image/jpeg" }),
    message({ id: "d4", chat: SAVED, mimetype: "image/webp" }),
    message({ id: "d5", chat: SAVED, mimetype: "audio/ogg; codecs=opus" }),
    message({ id: "d6", chat: SAVED, mimetype: "video/mp4" }),
    message({ id: "d7", chat: SAVED, mimetype: "application/pdf" }),
    message({ id: "d8", chat: SAVED, mimetype: "application/zip" }),
    message({ id: "d9", chat: SAVED, hasMedia: true }),
    message({ id: "d10", chat: SAVED, from: SAVED_LID, mimetype: "image/png" }),
    message({ id: "d11", chat: SAVED, from: SAVED_LID, mimetype: "image/png" }),
  ],
  [STRANGER]: [message({ id: "s1", chat: STRANGER, mimetype: "image/png" })],
  [GONE]: [message({ id: "x1", chat: GONE, body: "bye" })],
  [GROUP]: [
    message({ id: "g1", chat: GROUP, sender: SAVED_LID, mimetype: "image/png" }),
    message({ id: "g2", chat: GROUP, sender: STRANGER_LID, mimetype: "image/png" }),
    message({ id: "g3", chat: GROUP, sender: UNKNOWN_LID, mimetype: "image/png" }),
    message({ id: "g4", chat: GROUP, sender: SAVED_LID, body: "again" }),
    message({ id: "g5", chat: GROUP, sender: FAILING_LID, mimetype: "image/png" }),
  ],
};
const id = (chat, n) => messages[chat].find((m) => m.id.endsWith(`_${n}`)).id;
// 60 groups come last, which the defaults hide, so list_chats has to page past them.
const filler = Array.from({ length: 60 }, (_, i) => ({ id: `1203630000000001${String(i).padStart(2, "0")}@g.us`, name: null, lastMessage: null }));
const waha = await fakeWaha({
  sessions: {
    personal: {
      chats: [
        { id: GROUP, name: "Family", lastMessage: message({ id: "g5", chat: GROUP, sender: STRANGER_LID, hasMedia: true }) },
        { id: STRANGER, name: null, lastMessage: messages[STRANGER][0] },
        { id: "status@broadcast", name: null, lastMessage: null },
        ...filler,
        { id: SAVED, name: "Ana", lastMessage: message({ id: "d1", chat: SAVED, from: SAVED_LID, body: "hi" }) },
      ],
      messages,
      contacts: { [SAVED]: { name: "Ana" }, [SAVED_LID]: { name: "Ana" }, [STRANGER_LID]: { pushname: "Bo" }, [GONE]: null },
      lids: { [SAVED_LID]: SAVED, [STRANGER_LID]: STRANGER, [FAILING_LID]: "error" },
    },
  },
  files: Object.fromEntries(Object.values(messages).flat().filter((m) => m.hasMedia).map((m) => [m.id, PNG])),
  // A download that answers with a hidden group's message instead of the one that was checked.
  swap: { [id(SAVED, "d10")]: id(GROUP, "g1") },
});
after(() => waha.close());
const POLICY = { READ_SESSION: "", READ_CHATS: "", READ_GROUPS: "", TRANSCRIBE_URL: "" };

// A connector with these settings, as an MCP client: tools() lists its tools, call() runs one.
async function connector(settings) {
  const child = fork(new URL("./serve.mjs", import.meta.url), {
    env: { ...process.env, ...POLICY, WAHA_URL: waha.url, WAHA_API_KEY: "test", ...settings },
  });
  after(() => child.kill());
  const pending = new Map();
  let next = 0;
  child.on("message", ({ id, result, error }) => {
    pending.get(id)[error ? "reject" : "resolve"](error ? new Error(error) : result);
    pending.delete(id);
  });
  const ask = (request) =>
    new Promise((resolve, reject) => {
      pending.set(++next, { resolve, reject });
      child.send({ id: next, ...request });
    });
  return { tools: () => ask({ tools: true }), call: (name, args = {}) => ask({ name, args }) };
}

const reader = await connector({ READ_SESSION: "personal", READ_CHATS: "all", READ_GROUPS: "true" });

test("read_chat names each media kind from its mimetype", async () => {
  const history = await reader.call("read_chat", { chat: SAVED, limit: 20 });
  assert.deepEqual(
    history.map((m) => [m.id.split("_")[2], m.media]),
    [
      ["d1", null], ["d2", null], ["d3", "image"], ["d4", "image"], ["d5", "audio"], ["d6", "video"], ["d7", "pdf"],
      ["d8", "document"], ["d9", "other"], ["d10", "image"], ["d11", "image"],
    ],
  );
  assert.equal(history[6].text, "[pdf]");
});

test("list_chats shows each chat's last message and sender, never status updates", async () => {
  const chats = await reader.call("list_chats", { limit: 50 });
  assert.deepEqual(
    chats.slice(0, 2).map((c) => [c.chat, c.group, c.last.from, c.last.text]),
    [[GROUP, true, "Bo", "[other]"], [STRANGER, false, "contact", "[image]"]],
  );
  assert.ok(!chats.some((c) => c.chat === "status@broadcast"));
});

test("read_chat names senders, looking each one up once", async () => {
  const before = waha.requests.length;
  const direct = await reader.call("read_chat", { chat: SAVED, limit: 20 });
  assert.deepEqual(new Set(direct.map((m) => m.from)), new Set(["Ana", "me"]));
  // Ana writes by her number and by her hidden id: one lookup for each.
  assert.equal(waha.requests.slice(before).filter((r) => r.startsWith("/api/contacts?session=personal&contactId=")).length, 2);

  const group = await reader.call("read_chat", { chat: GROUP, limit: 20 });
  assert.deepEqual(group.map((m) => m.from), ["Ana", "Bo", "contact", "Ana", "contact"]);

  // A contact that WAHA answers with null still reads, as "contact".
  assert.deepEqual((await reader.call("read_chat", { chat: GONE })).map((m) => m.from), ["contact"]);
});

test("read_bill says whether the sender is saved, through hidden ids", async () => {
  const saved = async (chat, n) => (await reader.call("read_bill", { chat, message: id(chat, n) })).fromSavedContact;
  assert.equal(await saved(SAVED, "d3"), true);
  assert.equal(await saved(SAVED, "d11"), true);
  assert.equal(await saved(GROUP, "g1"), true);
  assert.equal(await saved(GROUP, "g2"), false);
  assert.equal(await saved(GROUP, "g3"), false);
  // The bill is still read when WhatsApp can't say who sent it.
  assert.equal(await saved(GROUP, "g5"), null);
});

test("media tools refuse a message of another kind", async () => {
  await assert.rejects(reader.call("view_image", { chat: SAVED, message: id(SAVED, "d7") }), /no image/);
  await assert.rejects(reader.call("read_pdf", { chat: SAVED, message: id(SAVED, "d3") }), /no pdf/);
});

test("by default, agents read only direct chats with saved contacts", async () => {
  const saved = await connector({ READ_SESSION: "personal" });
  assert.deepEqual((await saved.call("list_chats")).map((c) => c.chat), [SAVED]);
  assert.deepEqual((await saved.call("find_chat", { query: "5511" })).map((c) => c.chat), [SAVED]);
  assert.equal((await saved.call("read_chat", { chat: SAVED })).length, 11);
  for (const chat of [STRANGER, GROUP, "status@broadcast", "all", "120363000000000001@newsletter"]) {
    await assert.rejects(saved.call("read_chat", { chat }), /don't allow/, chat);
  }
  // WAHA finds a message by its id whatever chat the path names, so a hidden chat's media stays hidden,
  // and media is only taken from the message that was checked.
  await assert.rejects(saved.call("read_bill", { chat: SAVED, message: id(GROUP, "g1") }), /don't allow/);
  await assert.rejects(saved.call("read_bill", { chat: SAVED, message: id(STRANGER, "s1") }), /don't allow/);
  await assert.rejects(saved.call("read_bill", { chat: SAVED, message: id(SAVED, "d10") }), /different message/);
  assert.equal((await saved.call("read_bill", { chat: GROUP, message: id(SAVED, "d11") })).message, id(SAVED, "d11"));
});

test("find_chat checks many hidden matches at once", async () => {
  // 300 strangers whose numbers match, then the saved contact, with each contact lookup taking 50 ms.
  const strangers = Array.from({ length: 300 }, (_, i) => ({ id: `5511920000${String(i).padStart(3, "0")}@c.us`, conversationTimestamp: 2 }));
  const slow = await fakeWaha({
    sessions: { personal: { chats: [...strangers, { id: SAVED, conversationTimestamp: 1 }], contacts: { [SAVED]: { name: "Ana" } } } },
    delay: 50,
  });
  after(() => slow.close());
  const started = Date.now();
  const found = await (await connector({ READ_SESSION: "personal", WAHA_URL: slow.url })).call("find_chat", { query: "5511" });
  assert.deepEqual(found.map((c) => c.chat), [SAVED]);
  // One by one it would take 300 × 50 ms = 15 s.
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("READ_GROUPS adds groups, and READ_CHATS=all adds everyone", async () => {
  const groups = await connector({ READ_SESSION: "personal", READ_GROUPS: "true" });
  const listed = async (c) => (await c.call("list_chats", { limit: 50 })).map((c) => c.chat).filter((c) => !filler.some((f) => f.id === c));
  assert.deepEqual(await listed(groups), [GROUP]);
  await assert.rejects(groups.call("read_chat", { chat: STRANGER }), /don't allow/);
  assert.deepEqual(await listed(reader), [GROUP, STRANGER]);
  await assert.rejects(reader.call("read_chat", { chat: "status@broadcast" }), /don't allow/);
});

test("the connector refuses to start without a session to read", async () => {
  const child = fork(new URL("./serve.mjs", import.meta.url), {
    env: { ...process.env, ...POLICY, WAHA_URL: waha.url, WAHA_API_KEY: "test" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  assert.equal(await new Promise((resolve) => child.on("exit", resolve)), 1);
  assert.match(stderr, /Set READ_SESSION/);
});

test("it only reads: no tool sends", async () => {
  const read = ["list_chats", "find_chat", "read_chat", "view_image", "view_video", "read_pdf", "read_bill"];
  assert.deepEqual(await reader.tools(), read);
  assert.deepEqual(waha.sent, []);
});

// The tool names in the first column of the README's "## Ferramentas" table, and of the site's table with this id.
// connectors/sicoob/test/server.test.mjs has the same three functions; change both.
function readmeTools(markdown) {
  const section = markdown.split("## Ferramentas")[1].split("\n## ")[0];
  return toolNames(section.split("\n").filter((line) => line.startsWith("| `")).map((line) => line.split("|")[1]));
}
function siteTools(html, id) {
  const table = html.split(`id="${id}"`)[1].split("</table>")[0];
  return toolNames([...table.matchAll(/<tr>\s*<td>(.*?)<\/td>/g)].map((match) => match[1]));
}
const toolNames = (cells) => [...new Set(cells.join(" ").match(/\b[a-z]+(?:_[a-z]+)+\b/g))].sort();

// The README and the site list the tools by hand, so they must name every tool the connector can serve, and no other.
test("the README and the site name exactly the tools it serves", async () => {
  const transcribing = await connector({ READ_SESSION: "personal", TRANSCRIBE_URL: "http://127.0.0.1:9" });
  const all = await transcribing.tools();
  assert.deepEqual(all, [...(await reader.tools()), "transcribe_audio"]);
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const site = await readFile(new URL("../../../site/index.html", import.meta.url), "utf8");
  assert.deepEqual(readmeTools(readme), [...all].sort(), "README");
  assert.deepEqual(siteTools(site, "whatsapp"), [...all].sort(), "site");
});
