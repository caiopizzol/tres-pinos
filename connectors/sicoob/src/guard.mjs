// The only requests this connector may make to Sicoob: the token for the read-only scope, the balance and a
// month's statement. The certificate itself can do much more, payments included.
import { readOnly as guard } from "@tres-pinos/api";
import { API_URL, SCOPE, TOKEN_URL } from "./sicoob.mjs";

const API = API_URL.replaceAll(".", "\\.");
const REQUESTS = [
  `^GET ${API}/conta-corrente/v4/saldo\\?numeroContaCorrente=\\d{1,14}$`,
  `^GET ${API}/conta-corrente/v4/extrato/([1-9]|1[0-2])/2\\d{3}\\?numeroContaCorrente=\\d{1,14}$`,
].map((pattern) => new RegExp(pattern));

export const readOnly = (fetch) =>
  guard(fetch, { tokenUrl: TOKEN_URL, scope: SCOPE, requests: REQUESTS });
