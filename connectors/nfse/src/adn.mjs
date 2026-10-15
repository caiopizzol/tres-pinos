// Reads the company's NFS-e from the national system's distribution (ADN): every document in which the company
// appears as issuer, recipient or intermediary, in the order the system numbered them (the NSU). The company's
// e-CNPJ authenticates each request (mutual TLS); there is no token.
// https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
import { gunzipSync } from "node:zlib";
import { MAX_BYTES, readNfse } from "@tres-pinos/nfse";

export const API_URL = "https://adn.nfse.gov.br/contribuintes";

// A request the ADN answered with an error status. It carries only the status.
export class AdnError extends Error {
  constructor(status) {
    super(`ADN request failed (HTTP ${status})`);
    this.status = status;
  }
}

// A gzip file in base64 as text. Bounded, so a small archive can't unpack into gigabytes; strict, so a broken byte
// fails instead of turning into a different character.
export const unzip = (base64) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    gunzipSync(Buffer.from(base64, "base64"), { maxOutputLength: MAX_BYTES }),
  );

const isNsu = (value) => Number.isSafeInteger(value) && value >= 0;
const isName = (value) => typeof value === "string" && /^[A-Z_]+$/.test(value);

// One document of a batch. An NFS-e is read in full. Any other document, such as a cancellation event, keeps
// only what the ADN says about it, so a kind this connector doesn't read never stops the listing.
function document(record, afterNsu) {
  const { NSU: nsu, TipoDocumento: type, ChaveAcesso: accessKey = null } = record ?? {};
  if (!isNsu(nsu) || nsu <= afterNsu) throw new Error("The ADN returned an invalid NSU");
  if (!isName(type) || !(accessKey === null || /^\d{50}$/.test(accessKey)))
    throw new Error(`The ADN returned an invalid document at NSU ${nsu}`);
  if (type !== "NFSE") {
    const eventType = record.TipoEvento ?? null;
    if (!(eventType === null || isName(eventType)))
      throw new Error(`The ADN returned an invalid document at NSU ${nsu}`);
    return { nsu, type, eventType, accessKey };
  }
  let xml;
  try {
    xml = unzip(record.ArquivoXml);
  } catch {
    throw new Error(`The ADN returned an unreadable file at NSU ${nsu}`);
  }
  const nfse = readNfse(xml);
  if (nfse.accessKey !== accessKey)
    throw new Error(`The ADN returned a different access key at NSU ${nsu}`);
  return { nsu, type, ...nfse };
}

export function adnClient(fetch) {
  return {
    fetch,

    // The next batch, of up to 50 documents, after `afterNsu`. `done` means there are none yet.
    async listDocuments(afterNsu) {
      if (!isNsu(afterNsu)) throw new Error("afterNsu is not an NSU");
      const res = await fetch(`${API_URL}/DFe/${afterNsu}?lote=true`, {
        headers: { Accept: "application/json" },
      });
      let body;
      try {
        body = JSON.parse(res.text);
      } catch {
        throw new AdnError(res.status);
      }
      if (res.status === 404 && body?.StatusProcessamento === "NENHUM_DOCUMENTO_LOCALIZADO")
        return { documents: [], lastNsu: afterNsu, done: true };
      if (res.status !== 200) throw new AdnError(res.status);
      if (
        body?.StatusProcessamento !== "DOCUMENTOS_LOCALIZADOS" ||
        !Array.isArray(body.LoteDFe) ||
        !body.LoteDFe.length
      )
        throw new Error("The ADN returned no documents");
      const documents = body.LoteDFe.map((record) => document(record, afterNsu));
      const nsus = documents.map((d) => d.nsu);
      if (new Set(nsus).size !== nsus.length) throw new Error("The ADN returned an NSU twice");
      return { documents, lastNsu: Math.max(...nsus), done: false };
    },
  };
}
