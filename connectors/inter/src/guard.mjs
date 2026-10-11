// Lets only the requests this connector was built to make reach Inter: the token for the read-only scope, the
// balance and a month's statement. Anything else, such as a payment, is refused before the network, even if a
// later change calls it by mistake. The integration itself may allow much more.
import { API_URL, PAGE_SIZE, SCOPE, TOKEN_URL } from "./inter.mjs";

const API = API_URL.replaceAll(".", "\\.");
const DATE = "2\\d{3}-\\d{2}-\\d{2}";
const REQUESTS = [
  `^GET ${API}/banking/v2/saldo$`,
  `^GET ${API}/banking/v2/extrato/completo\\?dataInicio=${DATE}&dataFim=${DATE}&tamanhoPagina=${PAGE_SIZE}$`,
].map((pattern) => new RegExp(pattern));

const guarded = new WeakSet();
export const isReadOnly = (fetch) => guarded.has(fetch);

export function readOnly(fetch) {
  const guard = (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    // A body can repeat `scope`; only the one read-only scope passes.
    const scopes =
      typeof init.body === "string" ? new URLSearchParams(init.body).getAll("scope") : [];
    const allowed =
      url === TOKEN_URL
        ? method === "POST" && scopes.length === 1 && scopes[0] === SCOPE
        : REQUESTS.some((p) => p.test(`${method} ${url}`));
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
