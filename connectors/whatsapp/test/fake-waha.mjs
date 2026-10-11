// A WAHA stand-in for tests: serves each session's chats, messages, contacts and hidden ids from plain
// objects, shaped like WAHA's engine-neutral responses, and records every request. A contact set to null
// answers like a missing contact, and a lid set to "error" like a failing WAHA. `swap` makes a
// media download answer with another message, and `delay` slows every contact lookup by that many ms.
import { createServer } from "node:http";

export async function fakeWaha({ sessions, files = {}, swap = {}, delay = 0 }) {
  const requests = [];
  const sent = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://waha");
    requests.push(url.pathname + url.search);
    const json = (body) =>
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    const page = (list) => {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return list.slice(offset, offset + Number(url.searchParams.get("limit") ?? list.length));
    };
    let match;
    if ((match = url.pathname.match(/^\/api\/files\/(.+)$/)))
      return res.writeHead(200).end(files[match[1]]);
    // Records any attempt to send, so a test can check there are none.
    if (url.pathname === "/api/sendText") {
      sent.push(url.pathname);
      return res.writeHead(500).end();
    }

    const name = url.pathname.startsWith("/api/contacts")
      ? url.searchParams.get("session")
      : url.pathname.split("/")[2];
    if (!sessions[name]) return res.writeHead(404).end();
    const { chats = [], messages = {}, contacts = {}, lids = {} } = sessions[name];
    if (url.pathname === "/api/contacts/check-exists") {
      return json({ numberExists: true, chatId: `${url.searchParams.get("phone")}@c.us` });
    }
    if (url.pathname === "/api/contacts") {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const id = url.searchParams.get("contactId");
      return json(contacts[id] === null ? null : { id, name: "", pushname: "", ...contacts[id] });
    }
    if ((match = url.pathname.match(/^\/api\/[\w-]+\/lids\/([^/]+)$/))) {
      const lid = decodeURIComponent(match[1]);
      if (lids[lid] === "error") return res.writeHead(500).end();
      return json({ lid, pn: lids[lid] ?? null });
    }
    if (/^\/api\/[\w-]+\/chats(\/overview)?$/.test(url.pathname)) return json(page(chats));
    if ((match = url.pathname.match(/^\/api\/[\w-]+\/chats\/([^/]+)\/messages$/))) {
      return json(page([...(messages[decodeURIComponent(match[1])] ?? [])].reverse()));
    }
    if ((match = url.pathname.match(/^\/api\/[\w-]+\/chats\/[^/]+\/messages\/([^/]+)$/))) {
      // Like GOWS, it finds the message by its id alone, whatever chat the path names.
      const download = url.searchParams.get("downloadMedia") === "true";
      let id = decodeURIComponent(match[1]);
      if (download && swap[id]) id = swap[id];
      const m = Object.values(messages)
        .flat()
        .find((m) => m.id === id);
      if (!m) return res.writeHead(404).end();
      return json(
        download && files[id]
          ? { ...m, media: { ...m.media, url: `http://waha/api/files/${id}` } }
          : m,
      );
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    sent,
    close: () => server.close(),
  };
}

// A message as WAHA returns it: its id names its chat, `from` is the chat, which WhatsApp may name by a
// hidden id (@lid), and in a group `participant` is the sender.
export const message = ({
  id,
  chat,
  from = chat,
  sender,
  fromMe = false,
  body = "",
  mimetype,
  hasMedia = Boolean(mimetype),
  timestamp = 1_760_000_000,
}) => ({
  id: `${fromMe}_${chat}_${id}`,
  timestamp,
  from,
  fromMe,
  participant: chat.endsWith("@g.us") ? sender : null,
  body,
  hasMedia,
  media: mimetype ? { url: null, mimetype, filename: null } : null,
});
