// The only requests this connector may make to Sicoob: the balance and a month's statement and, when the owner turns
// paying on, looking a boleto up, finding a payment made for it, and paying it. The certificate itself can do much
// more, such as Pix or cancelling a scheduled payment.
import { allowOnly } from "@tres-pinos/api";
import { API_URL, LOOKUP_SCOPE, PAY_SCOPE, SCOPE, TOKEN_URL } from "./sicoob.mjs";

const API = API_URL.replaceAll(".", "\\.");
const ACCOUNT = "numeroConta=\\d{1,14}";
// A boleto's barcode; one starting with 8 is a guia (arrecadação), which another API pays.
const BARCODE = "[0-79]\\d{43}";
const READ = [
  `^GET ${API}/conta-corrente/v4/saldo\\?numeroContaCorrente=\\d{1,14}$`,
  `^GET ${API}/conta-corrente/v4/extrato/([1-9]|1[0-2])/2\\d{3}\\?numeroContaCorrente=\\d{1,14}$`,
].map((pattern) => new RegExp(pattern));
const PAY = [
  `^GET ${API}/pagamentos/v3/boletos/${BARCODE}\\?${ACCOUNT}&dataPagamento=2\\d{3}-\\d{2}-\\d{2}$`,
  `^GET ${API}/pagamentos/v3/boletos/pagamentos/\\d{4}-\\d{1,14}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/idempotency/comprovantes\\?${ACCOUNT}$`,
  `^POST ${API}/pagamentos/v3/boletos/pagamentos/${BARCODE}$`,
].map((pattern) => new RegExp(pattern));

export const guard = (fetch, { pay = false } = {}) =>
  allowOnly(fetch, {
    tokenUrl: TOKEN_URL,
    scopes: pay ? [SCOPE, LOOKUP_SCOPE, PAY_SCOPE] : [SCOPE],
    requests: pay ? [...READ, ...PAY] : READ,
  });
