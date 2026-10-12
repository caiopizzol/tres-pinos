// The only request this connector may make: the next batch of the distribution. The e-CNPJ itself can do much
// more in the national system, such as issuing and cancelling invoices.
import { readOnly as guard } from "@tres-pinos/api";
import { API_URL } from "./adn.mjs";

const API = API_URL.replaceAll(".", "\\.");
const REQUESTS = [new RegExp(`^GET ${API}/DFe/\\d{1,16}\\?lote=true$`)];

export const readOnly = (fetch) => guard(fetch, { requests: REQUESTS });
