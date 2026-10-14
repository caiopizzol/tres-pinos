// What SKILL.md tells the agent about the connector, checked against the connector itself: the tools and fields it
// names exist, and the fictional quarter an agent is tested on adds up as the skill says. A change to the connector
// that would break the skill fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { COMPANY, KEY, QUARTER, start } from "./quarter.mjs";

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

const server = await start();
after(server.close);

async function call(name, args) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
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
    const batch = await call("list_invoices", { afterNsu });
    documents.push(...batch.documents);
    if (batch.done) return documents;
    afterNsu = batch.lastNsu;
  }
}

test("the skill has a name and a description, which Claude Code and Codex both need", () => {
  const frontmatter = skill.split("---")[1];
  assert.match(frontmatter, /^name: estimar-impostos$/m);
  assert.match(frontmatter, /^description: .+$/m);
});

test("the tools and fields the skill names are the ones the connector gives", async () => {
  const documents = await allDocuments();
  const invoice = documents.find((d) => d.type === "NFSE");
  const cancellation = documents.find((d) => d.type !== "NFSE");
  const named = {
    list_invoices: true,
    afterNsu: true,
    lastNsu: true,
    done: true,
    "provider.id": "id" in invoice.provider,
    competence: "competence" in invoice,
    accessKey: "accessKey" in invoice && "accessKey" in cancellation,
    serviceAmountCents: "serviceAmountCents" in invoice,
  };
  for (const [name, given] of Object.entries(named)) {
    assert.ok(skill.includes(`\`${name}\``), `SKILL.md names ${name}`);
    assert.ok(given, `the connector gives ${name}`);
  }
});

test("the fictional quarter adds up to the revenue, IRPJ and CSLL the skill's rules give", async () => {
  const documents = await allDocuments();
  assert.ok(documents.length > 50, "more than one batch");
  const cancelled = new Set(documents.filter((d) => d.type !== "NFSE").map((d) => d.accessKey));
  const counted = documents.filter(
    (d) =>
      d.type === "NFSE" &&
      d.provider.id === COMPANY &&
      d.competence >= "2026-04-01" &&
      d.competence <= "2026-06-30" &&
      !cancelled.has(d.accessKey),
  );
  assert.deepEqual(counted.map((d) => d.number).sort(), ["1", "2", "3"]);
  const revenue = counted.reduce((sum, d) => sum + d.serviceAmountCents, 0);
  const base = Math.round(revenue * 0.32);
  const irpj = Math.round(base * 0.15) + Math.round(Math.max(0, base - 6_000_000) * 0.1);
  const csll = Math.round(base * 0.09);
  assert.deepEqual({ revenueCents: revenue, irpjCents: irpj, csllCents: csll }, QUARTER);
});
