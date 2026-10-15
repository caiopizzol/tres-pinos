// Reads an NFS-e in the national layout (Sistema Nacional NFS-e, versions 1.00 and 1.01) into plain facts. It
// never guesses: a missing, repeated or malformed field fails the read. It does not check the signature.
// https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
import { DOMParser } from "@xmldom/xmldom";

const NS = "http://www.sped.fazenda.gov.br/nfse";
const VERSIONS = ["1.00", "1.01"];
// Larger than any invoice, small enough that a hostile file can't exhaust memory.
export const MAX_BYTES = 1_000_000;

// An access key: municipality, environment, registration type, the issuer's CNPJ, then digits. Since August 2026 the
// CNPJ can have letters (TSIdNFSe in the schemas 1.01 of 2026-07-27).
export const ACCESS_KEY = /^\d{9}[0-9A-Z]{14}\d{27}$/;

// A DPS Id: municipality, 1 for CPF or 2 for CNPJ, the federal ID, the series and the number.
export const DPS_ID = /^DPS\d{7}[12][0-9A-Z]{14}\d{20}$/;

export class NfseError extends Error {}

function parse(xml) {
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new NfseError("The XML is larger than 1 MB");
  // A DOCTYPE is never part of an NFS-e, and it is how entity attacks start.
  if (/<!DOCTYPE/i.test(xml)) throw new NfseError("The XML has a DOCTYPE");
  try {
    return new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new Error(message);
      },
    }).parseFromString(xml, "application/xml");
  } catch {
    throw new NfseError("The file is not well-formed XML");
  }
}

// The direct children of `parent` named `name` in the NFS-e namespace.
const children = (parent, name) =>
  Array.from(parent.childNodes).filter(
    (node) => node.nodeType === 1 && node.namespaceURI === NS && node.localName === name,
  );

// Exactly one child, or none when optional; a repeated field is ambiguous, so it fails.
function child(parent, name, optional = false) {
  const found = children(parent, name);
  if (found.length > 1) throw new NfseError(`${name} appears more than once`);
  if (!found.length && !optional) throw new NfseError(`${name} is missing`);
  return found[0] ?? null;
}

// A field's own text. A field that holds other elements is not a value.
function text(parent, name, optional = false) {
  const element = child(parent, name, optional);
  if (Array.from(element?.childNodes ?? []).some((node) => node.nodeType === 1))
    throw new NfseError(`${name} holds elements instead of a value`);
  const value = element?.textContent.trim();
  if (!optional && !value) throw new NfseError(`${name} is empty`);
  return value || null;
}

// A decimal amount such as "1500.5" as exact integer cents; a fraction of a cent fails.
function cents(parent, name) {
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text(parent, name));
  if (!match) throw new NfseError(`${name} is not an amount in reais and cents`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

// Who a party is: a Brazilian CNPJ or CPF, a foreign tax ID (NIF), or the reason there is none (cNaoNIF).
// The layout allows exactly one of them; two would make the party ambiguous.
function identity(party) {
  const given = ["CNPJ", "CPF", "NIF", "cNaoNIF"].filter((kind) => text(party, kind, true));
  if (given.length !== 1)
    throw new NfseError("A party needs exactly one of CNPJ, CPF, NIF or cNaoNIF");
  const [kind] = given;
  if (kind === "cNaoNIF") return { idType: "none", noIdReason: text(party, kind) };
  return { idType: kind, id: text(party, kind) };
}

function party(element) {
  return element && { ...identity(element), name: text(element, "xNome", true) };
}

// The provider also carries its municipal registration, when the DPS gives one, and its standing in the Simples
// Nacional: 1 not opted in, 2 MEI, 3 ME/EPP. The national system checks that against its register (E0160).
function provider(element) {
  const simples = text(child(element, "regTrib"), "opSimpNac");
  if (!["1", "2", "3"].includes(simples)) throw new NfseError("opSimpNac is not 1, 2 or 3");
  return {
    ...party(element),
    municipalRegistration: text(element, "IM", true),
    simplesNacional: simples,
  };
}

// The approximate share of federal taxes the provider declared (Lei 12.741/2012), such as "7.68", or null when it
// declared them another way.
function federalTaxPercent(values) {
  const percent = child(child(child(values, "trib"), "totTrib"), "pTotTrib", true);
  if (!percent) return null;
  const value = text(percent, "pTotTribFed");
  if (!/^\d{1,3}(\.\d{2})?$/.test(value)) throw new NfseError("pTotTribFed is not a percentage");
  return value;
}

// An optional amount: absent is 0, present must be an amount.
const optionalCents = (parent, name) =>
  parent && child(parent, name, true) ? cents(parent, name) : 0;

// An optional code from the layout's list, or null when absent.
function code(parent, name, allowed) {
  const value = parent && text(parent, name, true);
  if (value != null && !allowed.test(value))
    throw new NfseError(`${name} is not a code the layout defines`);
  return value ?? null;
}

// What the note declares about withholding, field by field as the layout names them. `issqn` says who withholds the
// ISS (1 no one, 2 the recipient, 3 the intermediary) and `issqnCents` is the ISS amount; `pisCofins.withholding` is
// the layout's code 0 to 9 for which of PIS, COFINS and CSLL were withheld, and its amounts are the provider's own
// PIS and COFINS. No total: real notes put PIS and COFINS that weren't withheld in vTotalRet, and keep vLiq at the
// full amount when the recipient withholds the ISS.
function withholdings(dpsValues, nfseValues) {
  const trib = child(dpsValues, "trib");
  const federal = child(trib, "tribFed", true);
  const pisCofins = federal && child(federal, "piscofins", true);
  return {
    irrfCents: optionalCents(federal, "vRetIRRF"),
    cpCents: optionalCents(federal, "vRetCP"),
    csllCents: optionalCents(federal, "vRetCSLL"),
    issqn: code(child(trib, "tribMun"), "tpRetISSQN", /^[123]$/),
    issqnCents: optionalCents(nfseValues, "vISSQN"),
    pisCofins: pisCofins && {
      cst: code(pisCofins, "CST", /^\d{2}$/),
      withholding: code(pisCofins, "tpRetPisCofins", /^\d$/),
      pisCents: optionalCents(pisCofins, "vPis"),
      cofinsCents: optionalCents(pisCofins, "vCofins"),
    },
  };
}

// The IBS and CBS the national system calculated (reforma tributária, LC 214/2025), or null when the note has none.
function ibsCbs(inf) {
  const group = child(inf, "IBSCBS", true);
  if (!group) return null;
  const totals = child(group, "totCIBS");
  return {
    ibsCents: cents(child(totals, "gIBS"), "vIBSTot"),
    cbsCents: cents(child(totals, "gCBS"), "vCBS"),
  };
}

export function readNfse(xml) {
  const root = parse(xml).documentElement;
  if (root?.namespaceURI !== NS || root.localName !== "NFSe")
    throw new NfseError("This is not an NFS-e in the national layout");
  const version = root.getAttribute("versao");
  if (!VERSIONS.includes(version))
    throw new NfseError(`Layout version ${version || "(none)"} is not supported`);

  const inf = child(root, "infNFSe");
  const accessKey = /^NFS(.*)$/.exec(inf.getAttribute("Id"))?.[1];
  if (!ACCESS_KEY.test(accessKey ?? "")) throw new NfseError("infNFSe has no valid access key");
  const dps = child(child(inf, "DPS"), "infDPS");
  const dpsId = dps.getAttribute("Id");
  if (!DPS_ID.test(dpsId ?? "")) throw new NfseError("infDPS has no valid Id");
  const service = child(dps, "serv");
  const values = child(dps, "valores");
  const discounts = child(values, "vDescCondIncond", true);

  return {
    version,
    accessKey,
    number: text(inf, "nNFSe"),
    // 100 generated, 101 substitution, 102 court order, 103 avulsa, 107 MEI. Cancellation comes as a separate event.
    generationCode: text(inf, "cStat"),
    generatedAt: text(inf, "dhProc"),
    // The DPS the invoice came from: municipality, federal ID, series and number.
    dpsId,
    dpsIssuedAt: text(dps, "dhEmi"),
    competence: text(dps, "dCompet"),
    issuer: party(child(inf, "emit")),
    provider: provider(child(dps, "prest")),
    recipient: party(child(dps, "toma", true)),
    serviceCode: text(child(service, "cServ"), "cTribNac"),
    description: text(child(service, "cServ"), "xDescServ"),
    serviceAmountCents: cents(child(values, "vServPrest"), "vServ"),
    // Optional in the layout: absent means no unconditional discount, but present must be an amount.
    unconditionalDiscountCents:
      discounts && child(discounts, "vDescIncond", true) ? cents(discounts, "vDescIncond") : 0,
    netAmountCents: cents(child(inf, "valores"), "vLiq"),
    withholdings: withholdings(values, child(inf, "valores")),
    ibsCbs: ibsCbs(inf),
    federalTaxPercent: federalTaxPercent(values),
  };
}
