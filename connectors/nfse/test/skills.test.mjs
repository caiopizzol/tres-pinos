// The skills that come with the connector, read as an agent reads them: read_skill gives each SKILL.md and every
// file it links to exactly as in the repository, and nothing else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { adnClient } from "../src/adn.mjs";
import { guard } from "../src/guard.mjs";
import { buildServer } from "../src/tools.mjs";

const SKILLS = ["emitir-nfse", "estimar-impostos"];

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await buildServer(adnClient(guard(fetch))).connect(serverSide);
const agent = new Client({ name: "test", version: "0" });
await agent.connect(clientSide);

const read = (uri) => agent.callTool({ name: "read_skill", arguments: { uri } });
const inRepo = (uri) =>
  readFileSync(new URL(`../../../skills/${uri.slice("skill://".length)}`, import.meta.url), "utf8");

test("the tool names each skill with its description, so the agent knows which to read", async () => {
  const { tools } = await agent.listTools();
  const { description, annotations } = tools.find((t) => t.name === "read_skill");
  assert.ok(annotations.readOnlyHint);
  for (const name of SKILLS) {
    const skill = inRepo(`skill://${name}/SKILL.md`);
    assert.ok(
      description.includes(`skill://${name}/SKILL.md: ${/^description: (.+)$/m.exec(skill)[1]}`),
    );
  }
});

test("each SKILL.md, and every file it links to, reads as in the repository", async () => {
  for (const name of SKILLS) {
    const uri = `skill://${name}/SKILL.md`;
    const skill = await read(uri);
    assert.equal(skill.content[0].text, inRepo(uri));
    const links = [...inRepo(uri).matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length);
    for (const link of links) {
      const reference = new URL(link, uri).href;
      assert.equal((await read(reference)).content[0].text, inRepo(reference), reference);
    }
  }
});

test("any other address is not found, so no file outside the skills is reached", async () => {
  for (const uri of [
    "skill://ler-conta/SKILL.md",
    "skill://emitir-nfse/README.md",
    "skill://emitir-nfse/../../connectors/nfse/src/server.mjs",
    "skill://emitir-nfse/references/%2e%2e/SKILL.md",
    "skill://emitir-nfse/test/company.mjs",
    "file:///etc/passwd",
  ]) {
    const result = await read(uri);
    assert.ok(result.isError, uri);
    assert.equal(result.content[0].text, "No such skill file");
  }
});
