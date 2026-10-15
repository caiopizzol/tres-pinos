// Issues the company's NFS-e in produção restrita, the national system's test environment, where an invoice has no
// legal effect. A DPS (the declaration the invoice is generated from) is checked against the official schema, signed
// with the company's e-CNPJ and sent; the e-CNPJ also authenticates the request (mutual TLS).
// https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
import { gzipSync } from "node:zlib";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { signDpsXml, validateDpsXml } from "open-nfse";
import { MAX_BYTES, readNfse } from "@tres-pinos/nfse";
import { unzip } from "./adn.mjs";

export const SEFIN_URL = "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
const NS = "http://www.sped.fazenda.gov.br/nfse";
// A DPS Id: municipality, 1 for CPF or 2 for CNPJ, the federal ID, the series and the number.
export const DPS_ID = /^DPS\d{7}[12][0-9A-Z]{14}\d{20}$/;

// A request the national system answered with an error status. It carries the status and the official error
// codes, never their text, which can quote the DPS.
export class SefinError extends Error {
  constructor(status, codes = []) {
    super(`Sefin request failed (HTTP ${status}${codes.length ? `, ${codes.join(", ")}` : ""})`);
    this.status = status;
    this.codes = codes;
  }
}

const json = (res) => {
  try {
    return JSON.parse(res.text);
  } catch {
    throw new SefinError(res.status);
  }
};
const codes = (body) =>
  (Array.isArray(body?.erros) ? body.erros : [])
    .map((e) => e?.Codigo ?? e?.codigo)
    .filter((c) => typeof c === "string" && /^[A-Z]\d{1,5}$/.test(c));

// The DPS of a produção restrita invoice as XML: one DPS element in the national namespace, for tpAmb 2, unsigned.
function readDps(xml) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_BYTES)
    throw new Error("The DPS is larger than 1 MB");
  if (/<!DOCTYPE/i.test(xml)) throw new Error("The DPS has a DOCTYPE");
  let root;
  try {
    root = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new Error(message);
      },
    }).parseFromString(xml, "application/xml").documentElement;
  } catch {
    throw new Error("The DPS is not well-formed XML");
  }
  if (root?.namespaceURI !== NS || root.localName !== "DPS")
    throw new Error("This is not a DPS in the national layout");
  // The schema allows a prefix such as <n:infDPS>, but the national system refuses one (E1228).
  if (
    Array.from(root.getElementsByTagNameNS(NS, "*"))
      .concat(root)
      .some((e) => e.prefix)
  )
    throw new Error("The DPS uses a namespace prefix, which the national system refuses");
  if (root.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature").length)
    throw new Error("The DPS is already signed");
  const inf = root.getElementsByTagNameNS(NS, "infDPS")[0];
  const id = inf?.getAttribute("Id");
  if (!DPS_ID.test(id ?? "")) throw new Error("The DPS has no valid Id");
  const tpAmb = inf.getElementsByTagNameNS(NS, "tpAmb")[0]?.textContent;
  if (tpAmb !== "2") throw new Error("The DPS must be for produção restrita (tpAmb 2)");
  // A DPS with subst replaces an invoice and cancels the original, through the same request.
  if (inf.getElementsByTagNameNS(NS, "subst").length)
    throw new Error("The DPS replaces an invoice (subst), which would cancel it");
  // The national system refuses a DPS that doesn't declare UTF-8 (E1229).
  return {
    id,
    xml: `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(root)}`,
  };
}

export function sefinClient(fetch, certificate) {
  return {
    fetch,

    // Checks the DPS against the official schema and signs it, without sending it.
    async prepare(dpsXml) {
      const { id, xml } = readDps(dpsXml);
      const { valid, violations } = await validateDpsXml(xml, { throwOnInvalid: false });
      // Only the element's name: the validator's message quotes the value, which can be an amount or an ID.
      if (!valid) {
        const field = /Element '(?:\{[^}]*\})?(\w+)'/.exec(violations[0]?.message ?? "")?.[1];
        throw new Error(`The DPS fails the official schema${field ? ` at ${field}` : ""}`);
      }
      return { id, signedXml: signDpsXml(xml, certificate) };
    },

    // Sends a DPS once. An answer that doesn't settle it, such as a timeout, is not retried here: `find` tells whether
    // the invoice was generated, so the same DPS is never sent twice.
    async issue(dpsXml) {
      const { id, signedXml } = await this.prepare(dpsXml);
      const res = await fetch(`${SEFIN_URL}/nfse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ dpsXmlGZipB64: gzipSync(signedXml).toString("base64") }),
      });
      const body = json(res);
      if (res.status !== 201) throw new SefinError(res.status, codes(body));
      if (typeof body.nfseXmlGZipB64 !== "string") throw new Error("Sefin returned no invoice");
      const xml = unzip(body.nfseXmlGZipB64);
      const nfse = readNfse(xml);
      // The invoice carries the DPS it was generated from; despite its name, the answer's idDps is "NFS" and the key.
      const from = new DOMParser()
        .parseFromString(xml, "application/xml")
        .getElementsByTagNameNS(NS, "infDPS")[0]
        ?.getAttribute("Id");
      if (from !== id || nfse.accessKey !== body.chaveAcesso)
        throw new Error("Sefin returned an invoice for a different DPS");
      return { dpsId: id, ...nfse };
    },

    // Whether an invoice was generated for the DPS `id`, and its access key.
    async find(id) {
      if (!DPS_ID.test(id)) throw new Error("Not a DPS Id");
      const res = await fetch(`${SEFIN_URL}/dps/${id}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) return { dpsId: id, issued: false };
      const body = json(res);
      if (res.status !== 200) throw new SefinError(res.status, codes(body));
      if (!/^\d{50}$/.test(body.chaveAcesso ?? ""))
        throw new Error("Sefin returned an invalid access key");
      return { dpsId: id, issued: true, accessKey: body.chaveAcesso };
    },
  };
}
