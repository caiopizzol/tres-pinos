// What the server's pages share: reading a form, escaping, the headers that keep a page out of frames and scripts,
// and the Três Pinos look.

export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// A request's body as text, decoded once at the end so a character split across chunks stays whole.
export async function read(req, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const send = (res, status, body, headers = {}) =>
  res.writeHead(status, { "Cache-Control": "no-store", ...headers }).end(body);

export const pageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  // Under no-referrer, browsers send "Origin: null" with the form, which the origin check refuses.
  "Referrer-Policy": "same-origin",
};

export const style = {
  body: "font:16px/1.5 system-ui;color:#1D1D1F;background:#F6F5F1;max-width:28rem;margin:4rem auto;padding:0 1rem",
  field:
    "display:block;width:100%;box-sizing:border-box;margin:.25rem 0 1rem;padding:.5rem;border:1px solid #E2DFD6;border-radius:8px;font:inherit",
  button:
    "padding:.5rem .9rem;border-radius:10px;border:1px solid #1D1D1F;font:inherit;font-weight:600",
};

// A page with `body`, which must already be escaped.
export const page = (res, status, body) =>
  send(
    res,
    status,
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Três Pinos</title><body style="${style.body}">
${body}`,
    pageHeaders,
  );
