// The owner's folder for the fictional month: invoices in dollars and the payment platform's withdrawal receipts,
// as PDFs like the real ones. `writeDocuments(dir)` writes them for an agent to read.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Each receipt's BRL total equals one credit in the Inter statement; its dollar amount leads to an invoice.
export const RECEIPTS = [
  {
    file: "saque-2026-09-11.pdf",
    date: "2026-09-11",
    usd: "2,000.00",
    rate: "4.90",
    brl: "9,800.00",
  },
  {
    file: "saque-2026-09-26.pdf",
    date: "2026-09-26",
    usd: "1,000.00",
    rate: "4.75",
    brl: "4,750.00",
  },
];

// INV-0007 has an NFS-e, which cites it; INV-0010 has none, so its credit is missing one.
export const CLIENT_INVOICES = [
  { number: "INV-0007", date: "2026-08-31", client: "ACME CORP", usd: "2,000.00" },
  { number: "INV-0010", date: "2026-09-25", client: "BETA INC", usd: "1,000.00" },
];

const receipt = (r) => [
  "PLATAFORMA DE PAGAMENTOS FICTICIA",
  "Comprovante de saque",
  `Data do saque: ${r.date}`,
  `Valor de origem: USD ${r.usd}`,
  `Cambio: 1 USD = ${r.rate} BRL`,
  `Total enviado: BRL ${r.brl}`,
  "Destino: conta da empresa, via Pix",
];
const invoice = (i) => [
  "INVOICE",
  `Invoice number: ${i.number}`,
  `Issue date: ${i.date}`,
  "Bill from: EMPRESA FICTICIA LTDA",
  `Bill to: ${i.client}`,
  "Software development services",
  `Total: USD ${i.usd}`,
];

// A one-page PDF with one line of Helvetica per item.
function pdf(lines) {
  const escape = (s) => s.replace(/[\\()]/g, "\\$&");
  const text = lines
    .map((l, n) => `BT /F1 12 Tf 50 ${780 - n * 20} Td (${escape(l)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, n) => {
    const at = out.length;
    out += `${n + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export function writeDocuments(dir) {
  mkdirSync(dir, { recursive: true });
  for (const r of RECEIPTS) writeFileSync(join(dir, r.file), pdf(receipt(r)));
  for (const i of CLIENT_INVOICES) writeFileSync(join(dir, `${i.number}.pdf`), pdf(invoice(i)));
}
