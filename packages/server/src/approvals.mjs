// Approvals the owner gives outside the agent, before a tool does something with legal or financial effect. A tool
// asks for one with what it will do; the owner reads it on /approve/<id> and approves it by typing the approval key;
// the tool then takes it, once. The server keeps only the key's SHA-256, so an agent that can read the settings still
// can't approve. Approvals live in memory and expire, so a restart drops them and the owner approves again.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { escape, page, read, send, style } from "./page.mjs";

const TTL_MS = 60 * 60_000;
// Once approved, the tool has this long to take it, so a forgotten approval doesn't stay usable for the hour.
const APPROVED_MS = 10 * 60_000;
// Wrong keys before the request is dropped, so the agent, which knows the link, can't keep guessing.
const MAX_WRONG = 5;
// Each pending approval holds its payload in memory, so a loop of requests replaces the oldest.
const MAX_PENDING = 100;

// Why a tool can't go on: its message is for the agent.
export class ApprovalError extends Error {}

// `name` is the hash's setting, such as NFSE_APPROVAL_HASH. `url` is where the owner opens the server, set by the
// owner, never taken from a request: an agent could otherwise point the link at a page of its own and read the key.
export function createApprovals({ name, hash, url, now = () => Date.now() }) {
  if (!/^[0-9a-f]{64}$/.test(hash ?? ""))
    throw new Error(`${name} must be the SHA-256 of the approval key, in hex`);
  if (!URL.canParse(url ?? ""))
    throw new Error("Approvals need the address the owner opens them at");
  // The owner types the key there, so it must not cross a network in the clear.
  const { protocol, hostname } = new URL(url);
  if (protocol !== "https:" && !["127.0.0.1", "localhost"].includes(hostname))
    throw new Error("Approvals need an https address, or 127.0.0.1 on this machine");
  const expected = Buffer.from(hash, "hex");
  // The key is 32 random bytes or more, so a short one is never the owner's, whatever its hash.
  const isOwner = (given) =>
    (given ?? "").length >= 32 &&
    timingSafeEqual(
      createHash("sha256")
        .update(given ?? "")
        .digest(),
      expected,
    );
  const origin = new URL(url).origin;
  const pending = new Map();

  // Asks the owner to approve `payload`, described by `title` and `summary` ([label, value] pairs). Returns the
  // approval's id and the link to it.
  function request({ title, summary, payload }) {
    for (const [id, entry] of pending) if (entry.expiresAt <= now()) pending.delete(id);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
    const id = randomBytes(24).toString("base64url");
    const link = `${origin}/approve/${id}`;
    pending.set(id, {
      title,
      summary,
      payload,
      approved: false,
      wrong: 0,
      expiresAt: now() + TTL_MS,
    });
    return { approval: id, link };
  }

  // The payload of an approved request, once: taken and removed with no await in between.
  function take(id) {
    const entry = pending.get(id);
    if (!entry || entry.expiresAt <= now()) {
      pending.delete(id);
      throw new ApprovalError(
        "No pending approval with this id: it expired, was used or was refused",
      );
    }
    if (!entry.approved)
      throw new ApprovalError(
        "The owner has not approved it yet. Wait for them to approve it at the link",
      );
    pending.delete(id);
    return entry.payload;
  }

  const until = (entry) =>
    new Date(entry.expiresAt).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });

  // The request and what the owner can do with it: approve or refuse while pending, cancel once approved.
  function form(res, id, entry, wrong = false) {
    const rows = entry.summary
      .map(
        ([label, value]) =>
          `<dt style="color:#6A675F;font-size:.9rem">${escape(label)}</dt><dd style="margin:0 0 .75rem">${escape(value)}</dd>`,
      )
      .join("");
    const refuse = `<button name="decision" value="refuse" formnovalidate style="${style.button};background:none">${entry.approved ? "Cancelar a aprovação" : "Recusar"}</button>`;
    const actions = entry.approved
      ? `<p>Aprovado. O agente pode seguir até ${until(entry)}.</p>${refuse}`
      : `<label>Chave de aprovação<input name="key" type="password" required autocomplete="current-password" style="${style.field}"></label>
${wrong ? '<p style="color:#B42318">Chave errada.</p>' : ""}
<button name="decision" value="approve" style="${style.button};background:#1D1D1F;color:#F7C831">Aprovar</button>
${refuse}`;
    page(
      res,
      wrong ? 401 : 200,
      `<h1 style="font-size:1.25rem">${escape(entry.title)}</h1><dl>${rows}</dl>
<form method="post" action="/approve/${id}">${actions}</form>`,
    );
  }

  // Answers /approve/<id>, and returns false for anything else. Refusing needs no key: it only ever stops a send.
  async function handle(req, res) {
    const id = /^\/approve\/([\w-]+)$/.exec(new URL(req.url, "http://x").pathname)?.[1];
    if (!id) return false;
    const live = (entry) => entry && pending.get(id) === entry && entry.expiresAt > now();
    const gone = () =>
      page(res, 404, "<p>Este pedido não existe mais: expirou, foi usado ou recusado.</p>");
    const entry = pending.get(id);
    if (!live(entry)) return (gone(), true);
    if (req.method === "GET") return (form(res, id, entry), true);
    if (req.method !== "POST") return (send(res, 405, ""), true);
    if (req.headers.origin !== origin) return (send(res, 403, "Origem errada."), true);
    const given = new URLSearchParams(await read(req));
    // The request may have changed while the form was read: taken, refused or expired.
    if (!live(entry)) return (gone(), true);
    if (given.get("decision") !== "approve") {
      pending.delete(id);
      page(res, 200, "<p>Recusado. Nada será enviado.</p>");
    } else if (entry.approved) form(res, id, entry);
    else if (!isOwner(given.get("key"))) {
      if (++entry.wrong >= MAX_WRONG) {
        pending.delete(id);
        page(res, 401, "<p>Chave errada muitas vezes. Peça ao agente um novo pedido.</p>");
      } else form(res, id, entry, true);
    } else {
      entry.approved = true;
      entry.expiresAt = Math.min(entry.expiresAt, now() + APPROVED_MS);
      form(res, id, entry);
    }
    return true;
  }

  return { request, take, handle };
}
