// The only requests this connector may make: the next batch of the distribution and, when the owner turns issuing on,
// sending a DPS in produção restrita and reading back what it generated. The e-CNPJ itself can do much more in the national system, such as
// issuing real invoices and cancelling them.
import { allowOnly } from "@tres-pinos/api";
import { ACCESS_KEY, DPS_ID } from "@tres-pinos/nfse";
import { API_URL } from "./adn.mjs";
import { SEFIN_URL } from "./sefin.mjs";

const pattern = (url) => url.replaceAll(".", "\\.");
const READ = [new RegExp(`^GET ${pattern(API_URL)}/DFe/\\d{1,16}\\?lote=true$`)];
const ISSUE = [
  new RegExp(`^GET ${pattern(SEFIN_URL)}/dps/${DPS_ID.source.slice(1)}`),
  new RegExp(`^GET ${pattern(SEFIN_URL)}/nfse/${ACCESS_KEY.source.slice(1)}`),
  new RegExp(`^POST ${pattern(SEFIN_URL)}/nfse$`),
];

export const guard = (fetch, { issue = false } = {}) =>
  allowOnly(fetch, { requests: issue ? [...READ, ...ISSUE] : READ });
