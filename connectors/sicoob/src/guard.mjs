// Lets only the requests this connector was built to make reach Sicoob: the token for the read-only scope,
// the balance and a month's statement. Anything else, such as a payment, is refused before the network,
// even if a later change calls it by mistake. The certificate itself can do much more.
import { API_URL, TOKEN_URL } from "./sicoob.mjs";

const API = API_URL.replaceAll(".", "\\.");
const REQUESTS = [
  `^GET ${API}/conta-corrente/v4/saldo\\?numeroContaCorrente=\\d{1,14}$`,
  `^GET ${API}/conta-corrente/v4/extrato/([1-9]|1[0-2])/2\\d{3}\\?numeroContaCorrente=\\d{1,14}$`,
].map((pattern) => new RegExp(pattern));

export function readOnly(fetch) {
  return (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    // A body can repeat `scope`; only the one read-only scope passes.
    const scopes =
      typeof init.body === "string" ? new URLSearchParams(init.body).getAll("scope") : [];
    const allowed =
      url === TOKEN_URL
        ? method === "POST" && scopes.length === 1 && scopes[0] === "cco_consulta"
        : REQUESTS.some((p) => p.test(`${method} ${url}`));
    if (!allowed) return Promise.reject(new Error(`Refused ${method} request`));
    return fetch(url, init).then((res) => {
      if (res.status >= 300 && res.status < 400)
        throw new Error(`Refused a ${res.status} redirect`);
      return res;
    });
  };
}
