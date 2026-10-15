// The only requests this connector may make to Inter: the token for the read-only scope, the balance and a
// month's statement. The integration itself may allow much more, payments included.
import { allowOnly } from "@tres-pinos/api";
import { API_URL, PAGE_SIZE, SCOPE, TOKEN_URL } from "./inter.mjs";

const API = API_URL.replaceAll(".", "\\.");
const DATE = "2\\d{3}-\\d{2}-\\d{2}";
const REQUESTS = [
  `^GET ${API}/banking/v2/saldo$`,
  `^GET ${API}/banking/v2/extrato/completo\\?dataInicio=${DATE}&dataFim=${DATE}&tamanhoPagina=${PAGE_SIZE}$`,
].map((pattern) => new RegExp(pattern));

export const readOnly = (fetch) =>
  allowOnly(fetch, { tokenUrl: TOKEN_URL, scope: SCOPE, requests: REQUESTS });
