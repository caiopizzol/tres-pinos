// A fictional company for the skill: the real NFS-e connector, with issuing on, behind its key, talking to a fake
// national system that issues for real. It already has one note, from DPS 1 of series 1, with the company's municipal
// registration. Run it to point Claude Code or Codex at it: `node skills/emitir-nfse/test/company.mjs <folder>`, which
// also writes the invoice to issue into <folder>.
import { createPrivateKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { serve } from "@tres-pinos/server";
import { adnClient, API_URL } from "../../../connectors/nfse/src/adn.mjs";
import { guard } from "../../../connectors/nfse/src/guard.mjs";
import { SEFIN_URL, sefinClient } from "../../../connectors/nfse/src/sefin.mjs";
import { buildServer } from "../../../connectors/nfse/src/tools.mjs";

export const COMPANY = "00000000000191";
export const MUNICIPAL_REGISTRATION = "1234567";
export const SERIES = "1";
export const KEY = "k".repeat(32);
// The invoice to issue, and what the skill should send for it: the Banco Central PTAX buying rate of its date, 2026-09-30, which the agent fetches for real.
export const INVOICE = {
  file: "INV-0012.pdf",
  number: "INV-0012",
  date: "2026-09-30",
  period: ["2026-09-16", "2026-09-30"],
  client: "ACME CORP",
  nif: "123456789",
  usd: "2,000.00",
};
export const RATE = { date: "09-30-2026", buying: 5.1803 };
export const EXPECTED = { usd: "2000.00", brl: "10360.60", nDPS: "2" };

const NS = "http://www.sped.fazenda.gov.br/nfse";
const FIXTURE = readFileSync(
  new URL("../../../packages/nfse/fixtures/nfse.xml", import.meta.url),
  "utf8",
);
const FIXTURE_KEY = "41069022200000000000191000000000000126090000000001";
const keyFor = (n) => `4106902${2}${COMPANY}${String(n).padStart(28, "0")}`;

// The company's earlier note: the fixture, with the municipal registration and an invoice it cites.
const earlier = FIXTURE.replaceAll(FIXTURE_KEY, keyFor(1))
  .replace("<regTrib>", `<IM>${MUNICIPAL_REGISTRATION}</IM><regTrib>`)
  .replace(
    "<xDescServ>Desenvolvimento de software &amp; manutenção</xDescServ>",
    "<xDescServ>Invoice INV-0011, de 2026-09-15</xDescServ>",
  );

// The notes the national system holds, as ADN records, and the DPS Ids it generated.
const records = [];
const issued = new Map();
function hold(xml, key, dpsId) {
  records.push({
    NSU: records.length + 1,
    ChaveAcesso: key,
    TipoDocumento: "NFSE",
    ArquivoXml: gzipSync(xml).toString("base64"),
  });
  issued.set(dpsId, key);
}
hold(earlier, keyFor(1), "DPS410690220000000000019100001000000000000001");
export const sent = [];

const answer = (status, body) => Promise.resolve({ status, text: JSON.stringify(body) });
const text = (doc, name) => doc.getElementsByTagNameNS(NS, name)[0]?.textContent;

// The fake national system: the distribution, the DPS lookup and issuing. An issued note is the fixture with the
// sent DPS inside, as the real one returns it.
function national(url, init = {}) {
  if (url.startsWith(`${API_URL}/DFe/`)) {
    const after = Number(/\/DFe\/(\d+)\?lote=true$/.exec(url)?.[1]);
    const batch = records.filter((r) => r.NSU > after).slice(0, 50);
    if (!batch.length) return answer(404, { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" });
    return answer(200, { StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: batch });
  }
  const lookup = /\/dps\/(DPS\d+)$/.exec(url)?.[1];
  if (lookup)
    return issued.has(lookup)
      ? answer(200, { chaveAcesso: issued.get(lookup) })
      : answer(404, { erro: { codigo: "E404" } });
  if (url === `${SEFIN_URL}/nfse` && init.method === "POST") {
    const dpsXml = gunzipSync(
      Buffer.from(JSON.parse(init.body).dpsXmlGZipB64, "base64"),
    ).toString();
    sent.push(dpsXml);
    const doc = new DOMParser().parseFromString(dpsXml, "application/xml");
    const id = doc.getElementsByTagNameNS(NS, "infDPS")[0].getAttribute("Id");
    if (issued.has(id)) return answer(400, { erros: [{ Codigo: "E0014" }] });
    const key = keyFor(records.length + 1);
    const dps = dpsXml.slice(dpsXml.indexOf("<DPS"));
    const nfse = FIXTURE.replaceAll(FIXTURE_KEY, key)
      .replace(/<DPS[\s\S]*<\/DPS>/, dps)
      .replace("<nNFSe>1</nNFSe>", `<nNFSe>${records.length + 1}</nNFSe>`)
      .replace("<vLiq>1450.50</vLiq>", `<vLiq>${text(doc, "vServ")}</vLiq>`);
    hold(nfse, key, id);
    return answer(201, {
      idDps: `NFS${key}`,
      chaveAcesso: key,
      nfseXmlGZipB64: gzipSync(nfse).toString("base64"),
    });
  }
  return answer(404, {});
}

// A throwaway certificate, so the connector signs as it would with the e-CNPJ.
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), "emitir-nfse-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=EMPRESA FICTICIA LTDA:${COMPANY}`,
      "-keyout",
      join(dir, "k.pem"),
      "-out",
      join(dir, "c.pem"),
    ],
    { stdio: "ignore" },
  );
  return {
    keyPem: createPrivateKey(readFileSync(join(dir, "k.pem"))),
    certPem: readFileSync(join(dir, "c.pem"), "utf8"),
  };
}

// The invoice as a one-page PDF, like the real ones.
export function writeInvoice(dir) {
  const i = INVOICE;
  const lines = [
    "INVOICE",
    `Invoice number: ${i.number}`,
    `Issue date: ${i.date}`,
    `Service period: ${i.period[0]} to ${i.period[1]}`,
    "Bill from: EMPRESA FICTICIA LTDA",
    `Bill to: ${i.client}, Tax ID ${i.nif}`,
    "500 Market St, Suite 100, Financial District",
    "San Francisco, CA 94105, United States",
    "Software development services",
    `Total: USD ${i.usd}`,
  ];
  const escape = (s) => s.replace(/[\\()]/g, "\\$&");
  const stream = lines
    .map((l, n) => `BT /F1 12 Tf 50 ${780 - n * 20} Td (${escape(l)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, n) => {
    const at = pdf.length;
    pdf += `${n + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, i.file), pdf);
}

// Starts the connector and returns its MCP URL.
export function start({ port = 0 } = {}) {
  const fetch = guard(national, { issue: true });
  const server = serve({
    name: "NFSE_KEY",
    key: KEY,
    tools: () => buildServer(adnClient(fetch), undefined, sefinClient(fetch, certificate())),
    port,
  });
  return new Promise((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  ).then(() => ({
    nfse: `http://127.0.0.1:${server.address().port}/mcp`,
    close: () => server.close(),
  }));
}

if (import.meta.main) {
  writeInvoice(process.argv[2] ?? ".");
  const { nfse } = await start({ port: 3115 });
  console.log(`nfse ${nfse}`);
}
