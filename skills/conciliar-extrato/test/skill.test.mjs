// What SKILL.md tells the agent about the connectors, checked against the connectors themselves: the tools and fields
// it names exist, and the fictional month an agent is tested on reads as the skill expects. A change to a connector
// that would break the skill fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  const { transactions } = await call(servers.inter, "get_statement", { month: MONTH });
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
  const { transactions } = await call(servers.inter, "get_statement", { month: MONTH });
  const credits = transactions.filter((t) => t.type === "CREDITO");
  assert.equal(credits.length, 6);
  const matches = credits.map(
    (credit) =>
      invoices.filter(
        (d) =>
          d.provider.id === COMPANY &&
          d.netAmountCents === credit.amountCents &&
          !documents.some((e) => e.type !== "NFSE" && e.accessKey === d.accessKey) &&
          Math.abs(Date.parse(d.dpsIssuedAt) - Date.parse(credit.date)) <= 120 * 86_400_000,
      ).length,
  );
  assert.deepEqual(matches, [1, 2, 0, 0, 0, 0]);
});
