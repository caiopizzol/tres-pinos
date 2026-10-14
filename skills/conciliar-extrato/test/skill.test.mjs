// What SKILL.md tells the agent about the connectors, checked against the connectors themselves: the tools and fields
// it names exist, and the fictional month an agent is tested on reads as the skill expects. A change to a connector
// that would break the skill fails here.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CLIENT_INVOICES, RECEIPTS, writeDocuments } from "./documents.mjs";
import { COMPANY, KEY, MONTH, start } from "./month.mjs";

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

const servers = await start();
after(servers.close);

async function call(url, name, args) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

// The company's notes, not cancelled, with the credit's amount and issued within 120 days of it: what the skill suggests.
const eligible = (documents, credit) =>
  documents.filter(
    (d) =>
      d.type === "NFSE" &&
      d.provider.id === COMPANY &&
      d.netAmountCents === credit.amountCents &&
      !documents.some((e) => e.type !== "NFSE" && e.accessKey === d.accessKey) &&
      Math.abs(Date.parse(d.dpsIssuedAt) - Date.parse(credit.date)) <= 120 * 86_400_000,
  );

// Every document, following lastNsu until done, as the skill says.
async function allDocuments() {
  const documents = [];
  for (let afterNsu = 0; ;) {
    const batch = await call(servers.nfse, "list_invoices", { afterNsu });
    documents.push(...batch.documents);
    if (batch.done) return documents;
    afterNsu = batch.lastNsu;
  }
}

test("the skill has a name and a description, which Claude Code and Codex both need", () => {
  const frontmatter = skill.split("---")[1];
  assert.match(frontmatter, /^name: conciliar-extrato$/m);
  assert.match(frontmatter, /^description: .+$/m);
});

test("the tools and fields the skill names are the ones the connectors give", async () => {
  const { transactions } = await call(servers.inter, "get_statement", {
    month: MONTH,
  });
  const credit = transactions.find((t) => t.type === "CREDITO");
  const documents = await allDocuments();
  const invoice = documents.find((d) => d.type === "NFSE");
  const cancellation = documents.find((d) => d.type !== "NFSE");
  const named = {
    get_statement: true,
    list_invoices: true,
    CREDITO: Boolean(credit),
    amountCents: "amountCents" in credit,
    afterNsu: true,
    lastNsu: true,
    done: true,
    "provider.id": "id" in invoice.provider,
    accessKey: "accessKey" in invoice && "accessKey" in cancellation,
    netAmountCents: "netAmountCents" in invoice,
  };
  for (const [name, given] of Object.entries(named)) {
    assert.ok(skill.includes(`\`${name}\``) || skill.includes(name), `SKILL.md names ${name}`);
    assert.ok(given, `the connectors give ${name}`);
  }
});

test("the skill names no bank: any connector with get_statement serves", () => {
  assert.doesNotMatch(skill.split("---")[2], /\b(Inter|Sicoob|inter|sicoob)\b/);
});

test("the fictional month: the invoices come in two batches, with one cancelled and one from another company", async () => {
  const documents = await allDocuments();
  const invoices = documents.filter((d) => d.type === "NFSE");
  assert.ok(documents.length > 50, "more than one batch");
  assert.deepEqual(
    documents.filter((d) => d.type !== "NFSE").map((d) => d.eventType),
    ["CANCELAMENTO"],
  );
  assert.deepEqual(
    invoices.filter((d) => d.provider.id !== COMPANY).map((d) => d.number),
    ["77"],
  );
  // The one credit the skill should match: a single invoice of the company with its net amount, within 120 days.
  const { transactions } = await call(servers.inter, "get_statement", {
    month: MONTH,
  });
  const credits = transactions.filter((t) => t.type === "CREDITO");
  assert.equal(credits.length, 8);
  assert.deepEqual(
    credits.map((credit) => eligible(documents, credit).length),
    [1, 2, 0, 0, 0, 0, 0, 0],
  );
});

// The two payments from abroad: no note has their amount, but each equals a receipt, whose dollars lead to an
// invoice. INV-0007's note cites it; INV-0010 has none, so that credit is missing a note.
test("the fictional month: payments from abroad lead through a receipt and an invoice to a note, or to none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "documentos-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeDocuments(dir);
  const text = (file) => execFileSync("pdftotext", [join(dir, file), "-"], { encoding: "utf8" });
  const documents = await allDocuments();
  const { transactions } = await call(servers.inter, "get_statement", { month: MONTH });
  const abroad = transactions.filter((t) => t.description.includes("PLATAFORMA"));
  const cents = (brl) => Math.round(Number(brl.replaceAll(",", "")) * 100);
  const chain = abroad.map((credit) => {
    const receipt = RECEIPTS.find((r) => cents(r.brl) === credit.amountCents);
    assert.match(text(receipt.file), new RegExp(`Total enviado: BRL ${receipt.brl}`));
    const invoice = CLIENT_INVOICES.find((i) => i.usd === receipt.usd);
    assert.match(text(`${invoice.number}.pdf`), new RegExp(`Total: USD ${invoice.usd}`));
    const notes = documents.filter(
      (d) => d.type === "NFSE" && d.description.includes(invoice.number),
    );
    return [invoice.number, notes.map((d) => d.number)];
  });
  assert.deepEqual(chain, [
    ["INV-0007", ["8"]],
    ["INV-0010", []],
  ]);
});

test("the fictional month: the Sicoob account adds one credit with an invoice and one without", async () => {
  const documents = await allDocuments();
  const { transactions } = await call(servers.sicoob, "get_statement", {
    month: MONTH,
  });
  const credits = transactions.filter((t) => t.type === "CREDITO");
  assert.deepEqual(
    credits.map((c) => eligible(documents, c).map((d) => d.number)),
    [["6"], []],
  );
});
