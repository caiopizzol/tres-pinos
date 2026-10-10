// Checks a running connector against its real WhatsApp sessions, through the MCP client. Prints counts,
// sizes, kinds and timing only, never message content, and never sends.
// WHATSAPP_URL defaults to the connector inside Compose.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { WHATSAPP_URL = "http://whatsapp:8080/mcp", WHATSAPP_TOKEN } = process.env;
const url = new URL(WHATSAPP_URL);
const auth = { authorization: `Bearer ${WHATSAPP_TOKEN}` };

let failed = 0;
const report = (ok, line) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
};
const status = async (headers) => (await fetch(url, { method: "POST", headers })).status;
report((await status({})) === 401, "no token is refused");
report((await status({ authorization: "Bearer nope" })) === 401, "a wrong token is refused");

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: auth } }));
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
report(!tools.some((t) => /send/.test(t)), "no tool sends");

// Runs a tool, timing it. Returns its parsed text and its images, or its error.
async function call(name, args) {
  const started = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const [first, ...rest] = r.content;
  if (r.isError) return { error: first.text, seconds };
  const text = first.type === "text" ? first.text : null;
  const images = r.content.filter((b) => b.type === "image").map((b) => Buffer.from(b.data, "base64").length);
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {}
  return { value, text, images, seconds, rest };
}

if (tools.includes("list_chats")) {
  const list = await call("list_chats", { limit: 30 });
  const chats = list.value ?? [];
  report(!list.error && chats.length > 0, `list_chats: ${chats.length} chats, ${chats.filter((c) => c.group).length} groups, in ${list.seconds}s`);

  // An unnamed chat is listed under its id, which find_chat would read as a number.
  const old = chats.findLast((c) => c.name !== c.chat.split("@")[0]);
  if (old) {
    const word = old.name.split(/\s+/).find((w) => w.length >= 3) ?? old.name;
    const found = await call("find_chat", { query: word.toUpperCase() });
    report(found.value?.some((c) => c.chat === old.chat), "find_chat finds a chat by one word of its name, uppercased");
  }
  report((await call("find_chat", { query: "zzzz-no-such-chat" })).value?.length === 0, "find_chat finds nothing for nonsense");
  report(Boolean((await call("read_chat", { chat: "all" })).error), "read_chat refuses WAHA's \"all\"");

  // The newest message of each media kind in recent chats.
  const media = {};
  for (const c of chats) {
    const read = await call("read_chat", { chat: c.chat, limit: 30 });
    if (read.error) {
      report(false, `read_chat: ${read.error}`);
      continue;
    }
    for (const m of read.value.reverse()) if (m.media) media[m.media] ??= { chat: c.chat, message: m.id };
  }
  console.log("media kinds seen:", Object.keys(media).join(", ") || "none");

  const runs = [
    ["image", "view_image", {}, (r) => `${r.images.length} JPEG, ${r.images[0]} bytes`],
    ["video", "view_video", {}, (r) => `${r.value.duration}s, frames at ${r.value.frames.join(", ")}, transcript: ${typeof r.value.transcript === "string" ? r.value.transcript : `${r.value.transcript.language}, ${r.value.transcript.text.split(/\s+/).length} words`}`],
    ["pdf", "read_pdf", {}, (r) => `${r.text.split(" pages")[0]} pages, ${r.text.length} characters, ${r.images.length} page images`],
    ["pdf", "read_bill", {}, (r) => `${r.value.type}${r.value.locked ? " locked" : ""}, saved contact ${r.value.fromSavedContact}, ${r.value.codes.map((c) => `${c.kind}:${c.status}`).join(" ") || "no codes"}`],
    ["audio", "transcribe_audio", {}, (r) => `language ${r.value.language}, ${r.value.text.split(/\s+/).length} words`],
  ];
  for (const [kind, tool, args, describe] of runs) {
    if (!tools.includes(tool) || !media[kind]) {
      console.log(`skip ${tool}: ${tools.includes(tool) ? `no ${kind} in recent chats` : "not offered"}`);
      continue;
    }
    const r = await call(tool, { ...media[kind], ...args });
    report(!r.error, `${tool} in ${r.seconds}s: ${r.error ?? describe(r)}`);
  }
  if (media.image) {
    const wrongKind = await call("read_pdf", media.image);
    report(/no pdf/.test(wrongKind.error), "read_pdf refuses an image");
  }
}

await client.close();
process.exit(failed ? 1 : 0);
