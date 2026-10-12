// What every bank connector needs to reach a bank's official API: the certificate, a guard that lets out only
// the requests the connector was built to make, and exact amounts.
import { readFileSync } from "node:fs";
import https from "node:https";

// A certificate or key file. The container runs as uid 1000, which can't read a key owned by anyone else
// with mode 600.
export function readCertificate(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(
      error.code === "EACCES"
        ? `Can't read ${path}: give it to uid 1000 (see the README)`
        : `Can't read ${path}`,
    );
  }
}

// A fetch-like request over node:https with the certificate. Redirects are not followed: a redirect would
// carry the request, and the token request's credentials, to an address the guard never saw.
export function certificateFetch({ cert, key, passphrase, ca }, timeout = 10_000) {
  const agent = new https.Agent({ cert, key, passphrase, ca, keepAlive: true });
  return (url, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = https.request(url, { method, headers, agent, timeout }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("The bank did not answer in time")));
      req.on("error", reject);
      req.end(body);
    });
}

const guarded = new WeakSet();
export const isReadOnly = (fetch) => guarded.has(fetch);

// Lets through only a token request at `tokenUrl` for exactly `scope`, and requests whose "METHOD url" matches
// one of `requests`. Anything else, such as a payment, is refused before the network, even if a later change
// calls it by mistake. Without `tokenUrl`, only the listed requests pass.
export function readOnly(fetch, { tokenUrl, scope, requests }) {
  const guard = (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    // A body can repeat `scope`; only the one read-only scope passes.
    const scopes =
      typeof init.body === "string" ? new URLSearchParams(init.body).getAll("scope") : [];
    const allowed =
      url === tokenUrl
        ? method === "POST" && scopes.length === 1 && scopes[0] === scope
        : requests.some((p) => p.test(`${method} ${url}`));
    if (!allowed) return Promise.reject(new Error(`Refused ${method} request`));
    return fetch(url, init).then((res) => {
      if (res.status >= 300 && res.status < 400)
        throw new Error(`Refused a ${res.status} redirect`);
      return res;
    });
  };
  guarded.add(guard);
  return guard;
}

// A bank's decimal amount, such as "-12.3" or 1234.5, as exact integer cents.
export function toCents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  const match = typeof text === "string" ? /^(-?)(\d{1,12})(?:\.(\d{1,2})0*)?$/.exec(text) : null;
  if (!match) throw new Error("The bank returned an invalid amount");
  const [, sign, units, fraction = ""] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return sign && cents !== 0 ? -cents : cents;
}
