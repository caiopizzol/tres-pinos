// What SKILL.md and its template tell the agent, checked against the connector: the tools and fields it names exist,
// the template filled for the fictional invoice passes the official schema and issues, and the next DPS number is the
// first one find_invoice reports as not issued. A change to the connector that would break the skill fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  COMPANY,
  EXPECTED,
  FEDERAL_TAX_PERCENT,
  INVOICE,
  KEY,
  MUNICIPAL_REGISTRATION,
  SERIES,
  sent,
  start,
} from "./company.mjs";

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const reference = readFileSync(new URL("../references/exportacao.md", import.meta.url), "utf8");
const template = /```xml\n([\s\S]*?)```/.exec(reference)[1];

const server = await start();
after(server.close);

async function call(name, args) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.nfse), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const id = (n) =>
  `DPS4106902${2}${COMPANY}${SERIES.padStart(5, "0")}${String(n).padStart(15, "0")}`;

// The template filled as the skill says, for the fictional invoice.
const filled = (n) =>
  template
    .replace("{id}", id(n))
    .replace("{agora, AAAA-MM-DDThh:mm:ss-03:00}", "2026-10-15T10:00:00-03:00")
    .replace("{série}", SERIES)
    .replace("<nDPS>{número}</nDPS>", `<nDPS>${n}</nDPS>`)
    .replace("{competência, AAAA-MM-DD}", INVOICE.period[1])
    .replaceAll("{município}", "4106902")
    .replace("{CNPJ}", COMPANY)
    .replace("{inscrição municipal}", MUNICIPAL_REGISTRATION)
    .replace("{NIF do cliente}", INVOICE.nif)
    .replace("{nome do cliente}", INVOICE.client.replaceAll("&", "&amp;"))
    .replace("{país, ISO de 2 letras}", "US")
    .replace("{código postal}", "94105")
    .replace("{cidade}", "San Francisco")
    .replace("{estado}", "CA")
    .replace("{logradouro}", "Market St, Suite 100")
    .replace("<nro>{número}</nro>", "<nro>500</nro>")
    .replace("{bairro}", "Financial District")
    .replace("{país do cliente}", "US")
    .replace(
      "{descrição}",
      `Invoice ${INVOICE.number}, de ${INVOICE.date}. Serviço de ${INVOICE.period[0]} a ${INVOICE.period[1]}. USD ${EXPECTED.usd} x 5.1803 (PTAX de compra de ${INVOICE.date}) = R$ ${EXPECTED.brl}.`,
    )
    .replace("{valor em dólar, 0.00}", EXPECTED.usd)
    .replace("{valor em reais, 0.00}", EXPECTED.brl)
    .replace("{tributos federais, %}", FEDERAL_TAX_PERCENT);

test("the skill has a name and a description, which Claude Code and Codex both need", () => {
  const frontmatter = skill.split("---")[1];
  assert.match(frontmatter, /^name: emitir-nfse$/m);
  assert.match(frontmatter, /^description: .+$/m);
});

test("the tools and fields the skill names are the ones the connector gives", async () => {
  const { documents, lastNsu, done } = await call("list_invoices", { afterNsu: 0 });
  const [note] = documents;
  const body = skill.split("---")[2];
  for (const name of [
    "list_invoices",
    "find_invoice",
    "prepare_invoice",
    "issue_invoice",
    "afterNsu",
    "lastNsu",
    "done",
    "provider.id",
    "provider.municipalRegistration",
    "issuer.id",
    "dpsId",
    "description",
    "federalTaxPercent",
  ])
    assert.ok(body.includes(name), `SKILL.md names ${name}`);
  assert.equal(typeof lastNsu, "number");
  assert.equal(typeof done, "boolean");
  assert.equal(note.provider.id, COMPANY);
  assert.equal(note.issuer.id, COMPANY);
  assert.equal(note.provider.municipalRegistration, MUNICIPAL_REGISTRATION);
  assert.equal(note.dpsId, id(1));
  assert.match(note.description, /INV-0011/);
  assert.equal(note.federalTaxPercent, FEDERAL_TAX_PERCENT);
});

test("the next DPS number is the first that find_invoice reports as not issued", async () => {
  assert.equal((await call("find_invoice", { dpsId: id(1) })).issued, true);
  assert.equal((await call("find_invoice", { dpsId: id(2) })).issued, false);
});

test("the template, filled for the invoice, passes the official schema and issues", async () => {
  const { id: prepared } = await call("prepare_invoice", { dps: filled(EXPECTED.nDPS) });
  assert.equal(prepared, id(EXPECTED.nDPS));
  const invoice = await call("issue_invoice", { dps: filled(EXPECTED.nDPS) });
  assert.equal(invoice.dpsId, id(EXPECTED.nDPS));
  assert.equal(invoice.netAmountCents, 1_036_060);
  assert.match(sent.at(-1), new RegExp(`<vServMoeda>${EXPECTED.usd}</vServMoeda>`));
  // The fake doesn't refuse indTotTrib, but the real system does for a company outside the Simples (E0713).
  assert.match(sent.at(-1), new RegExp(`<pTotTribFed>${FEDERAL_TAX_PERCENT}</pTotTribFed>`));
  assert.doesNotMatch(sent.at(-1), /<indTotTrib>/);
  assert.equal((await call("find_invoice", { dpsId: id(EXPECTED.nDPS) })).issued, true);
});
