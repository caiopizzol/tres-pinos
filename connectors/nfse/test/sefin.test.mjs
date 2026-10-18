// Issuing in produção restrita, against a fake national system that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names; the DPS and the invoice are
// packages/nfse's fixture.
import assert from "node:assert/strict";
import { createHash, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { beforeEach, test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validateDpsXml } from "open-nfse";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { certificateFetch } from "@tres-pinos/api";
import { createApprovals } from "@tres-pinos/server";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { adnClient } from "../src/adn.mjs";
import { guard } from "../src/guard.mjs";
import { SEFIN_URL, SefinError, sefinClient, summarize } from "../src/sefin.mjs";
import { buildServer } from "../src/tools.mjs";

const certs = certificates({
  server: "/CN=localhost",
  owner: "/CN=EMPRESA FICTICIA LTDA:00000000000191",
});

const NFSE = readFileSync(new URL("../../../packages/nfse/fixtures/nfse.xml", import.meta.url));
const KEY = "41069022200000000000191000000000000126090000000001";
const ID = "DPS410690220000000000019100001000000000000001";
// The fixture's DPS, unsigned, as the agent would send it.
const DPS = (() => {
  const doc = new DOMParser().parseFromString(NFSE.toString(), "application/xml");
  const dps = doc.getElementsByTagName("DPS")[0];
  for (const s of Array.from(dps.getElementsByTagName("Signature"))) s.parentNode.removeChild(s);
  return new XMLSerializer().serializeToString(dps);
})();
// What the real system answers: idDps is "NFS" and the access key, and the invoice carries the DPS's Id.
const issued = (nfse = NFSE, key = KEY) => [
  201,
  { idDps: `NFS${key}`, chaveAcesso: key, nfseXmlGZipB64: gzipSync(nfse).toString("base64") },
];

let reply = null;
const fake = fakeApi(certs, (request) => (typeof reply === "function" ? reply(request) : reply));
const { requests } = fake;
beforeEach(() => {
  reply = [404, { erro: { codigo: "E404" } }];
});

// The real client, pointed at the fake: the national system's host is rewritten to it, and the fake's CA is trusted.
function client() {
  const real = certificateFetch({ ...certs.identity("owner"), ca: certs.read("ca.crt") });
  return (url, init) => real(url.replace(new URL(SEFIN_URL).origin, fake.url()), init);
}
const owner = certs.identity("owner");
const certificate = { keyPem: createPrivateKey(owner.key), certPem: owner.cert.toString() };
const sefin = () => sefinClient(guard(client(), { issue: true }), certificate);

test("issues a DPS once: checked, signed with the e-CNPJ, sent gzipped, and read back", async () => {
  reply = issued();
  const before = requests.length;
  const invoice = await sefin().issue(DPS);
  assert.equal(requests.length, before + 1);
  const { method, path, body, client: who } = requests.at(-1);
  assert.deepEqual(
    [method, path, who],
    ["POST", "/SefinNacional/nfse", "EMPRESA FICTICIA LTDA:00000000000191"],
  );
  const sent = gunzipSync(Buffer.from(JSON.parse(body).dpsXmlGZipB64, "base64")).toString();
  assert.ok(sent.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(sent, new RegExp(`<infDPS Id="${ID}">`));
  assert.match(
    sent,
    /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">.*<X509Certificate>/s,
  );
  assert.equal(invoice.dpsId, ID);
  assert.equal(invoice.accessKey, KEY);
  assert.equal(invoice.netAmountCents, 145050);
});

test("issues for a CNPJ with letters, whose access key carries them", async () => {
  const cnpj = "AB1C2D3E4F5G61";
  const key = KEY.replace("00000000000191", cnpj);
  const id = ID.replace("00000000000191", cnpj);
  const swap = (xml) => xml.replaceAll("00000000000191", cnpj).replaceAll(KEY, key);
  reply = issued(swap(NFSE.toString()), key);
  const invoice = await sefin().issue(swap(DPS));
  assert.deepEqual([invoice.dpsId, invoice.accessKey], [id, key]);
});

test("prepare signs without sending anything", async () => {
  const before = requests.length;
  const { id, signedXml } = await sefin().prepare(DPS);
  assert.equal(id, ID);
  assert.match(signedXml, /<SignatureValue>/);
  assert.equal(requests.length, before);
});

test("refuses a DPS that isn't for produção restrita, valid or unsigned, before the network", async () => {
  const before = requests.length;
  for (const [dps, error] of [
    [DPS.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"), /produção restrita/],
    [DPS.replace(/<cTribNac>\d+<\/cTribNac>/, ""), /official schema/],
    [
      DPS.replace(
        "</cLocEmi>",
        `</cLocEmi><subst><chSubstda>${KEY}</chSubstda><cMotivo>01</cMotivo></subst>`,
      ),
      /replaces an invoice/,
    ],
    [DPS.replace(`Id="${ID}"`, 'Id="DPS1"'), /valid Id/],
    [
      DPS.replace("</infDPS>", '</infDPS><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>'),
      /already signed/,
    ],
    [
      DPS.replace(/<(\/?)(?!\?)(\w+)/g, "<$1n:$2").replace(
        'xmlns="http://www.sped.fazenda.gov.br/nfse"',
        'xmlns:n="http://www.sped.fazenda.gov.br/nfse"',
      ),
      /namespace prefix/,
    ],
    [`<!DOCTYPE x>${DPS}`, /DOCTYPE/],
    [NFSE.toString(), /not a DPS/],
    ["<DPS", /not well-formed/],
  ])
    await assert.rejects(sefin().issue(dps), error, String(error));
  assert.equal(requests.length, before);
});

test("a substitution is refused even though the schema accepts it", async () => {
  const subst = DPS.replace(
    "</cLocEmi>",
    `</cLocEmi><subst><chSubstda>${KEY}</chSubstda><cMotivo>01</cMotivo></subst>`,
  );
  const { valid } = await validateDpsXml(`<?xml version="1.0" encoding="UTF-8"?>${subst}`, {
    throwOnInvalid: false,
  });
  assert.ok(valid);
  const before = requests.length;
  await assert.rejects(
    sefin().issue(subst),
    /replaces an invoice \(subst\), which would cancel it/,
  );
  assert.equal(requests.length, before);
});

test("a schema failure names the field, never its value", async () => {
  const error = await sefin()
    .prepare(DPS.replace("1500.50", "1234.567"))
    .catch((e) => e);
  assert.equal(error.message, "The DPS fails the official schema at vServ");
});

test("a rejection carries the status and the official codes, never their text", async () => {
  reply = [400, { erros: [{ Codigo: "E0014", Descricao: "CNPJ 00000000000191 já emitiu" }] }];
  const error = await sefin()
    .issue(DPS)
    .catch((e) => e);
  assert.ok(error instanceof SefinError);
  assert.deepEqual([error.status, error.codes], [400, ["E0014"]]);
  assert.doesNotMatch(error.message, /CNPJ/);
});

test("reading the returned invoice logs nothing, even on an XML warning", async (t) => {
  const logged = [];
  for (const level of ["error", "warn", "log"])
    t.mock.method(console, level, (...args) => logged.push(args.join(" ")));
  reply = issued(NFSE.toString().replace("<NFSe ", "<NFSe note=FICTIONAL_ACCOUNT_123 "));
  assert.equal((await sefin().issue(DPS)).accessKey, KEY);
  assert.deepEqual(
    logged.filter((line) => line.includes("FICTIONAL_ACCOUNT_123")),
    [],
  );
});

test("an invoice for a different DPS is not taken as this one's", async () => {
  reply = issued(NFSE.toString().replace(ID, "DPS410690220000000000019100001000000000000002"));
  await assert.rejects(sefin().issue(DPS), /different DPS/);
});

test("find tells whether a DPS generated an invoice, and reads back the invoice it did", async () => {
  assert.deepEqual(await sefin().find(ID), { dpsId: ID, issued: false });
  assert.equal(requests.at(-1).path, `/SefinNacional/dps/${ID}`);

  // The DPS lookup gives the key; the invoice comes from the test environment by that key.
  const nfseFor = (xml, key) => (request) =>
    request.path.startsWith("/SefinNacional/dps/")
      ? [200, { chaveAcesso: key }]
      : [200, { chaveAcesso: key, nfseXmlGZipB64: gzipSync(xml).toString("base64") }];
  reply = nfseFor(NFSE, KEY);
  const found = await sefin().find(ID);
  assert.deepEqual([found.issued, found.accessKey, found.dpsId], [true, KEY, ID]);
  assert.equal(requests.at(-1).path, `/SefinNacional/nfse/${KEY}`);

  // An alphanumeric CNPJ puts letters in the key.
  const cnpj = "AB1C2D3E4F5G61";
  const alphanumeric = KEY.replace("00000000000191", cnpj);
  const swapped = NFSE.toString().replaceAll("00000000000191", cnpj).replaceAll(KEY, alphanumeric);
  reply = nfseFor(swapped, alphanumeric);
  assert.equal((await sefin().find(ID.replace("00000000000191", cnpj))).accessKey, alphanumeric);

  reply = [200, { chaveAcesso: `X${alphanumeric.slice(1)}` }];
  await assert.rejects(sefin().find(ID), /invalid access key/);
  reply = nfseFor(NFSE.toString().replace(ID, ID.replace(/1$/, "2")), KEY);
  await assert.rejects(sefin().find(ID), /different DPS/);
  await assert.rejects(sefin().find("DPS1"), /Not a DPS Id/);
});

test("the guard lets out issuing only when it's on, and only in produção restrita", async () => {
  const before = requests.length;
  const off = guard(() => assert.fail("reached the network"));
  await assert.rejects(off(`${SEFIN_URL}/nfse`, { method: "POST" }), /Refused/);
  await assert.rejects(off(`${SEFIN_URL}/dps/${ID}`), /Refused/);
  const on = guard(() => assert.fail("reached the network"), { issue: true });
  for (const [url, init] of [
    ["https://sefin.nfse.gov.br/SefinNacional/nfse", { method: "POST" }],
    [`${SEFIN_URL}/nfse/${KEY}/eventos`, { method: "POST" }],
    [`${SEFIN_URL}/nfse/${KEY}`, { method: "POST" }],
    [`${SEFIN_URL}/nfse`, { method: "PUT" }],
    [`${SEFIN_URL}/dps/${ID}`, { method: "POST" }],
    [`${SEFIN_URL}/dps/DPS1`, {}],
  ])
    await assert.rejects(on(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the owner reads the DPS itself before approving: the main facts, then every field", () => {
  const summary = summarize(DPS);
  assert.deepEqual(summary.slice(0, 6), [
    ["Ambiente", "Produção restrita: teste, sem valor fiscal"],
    ["Tomador", "FULANO & FILHOS"],
    ["Valor do serviço", "R$ 1.500,50"],
    ["Competência", "2026-08-31"],
    ["Descrição", "Desenvolvimento de software & manutenção"],
    ["DPS", ID],
  ]);
  const all = new Map(summary.slice(6));
  assert.equal(all.get("prest › CNPJ"), "00000000000191");
  assert.equal(all.get("valores › vServPrest › vServ"), "1500.50");
  // A choice that changes the invoice, such as a discount, is on the page too.
  const discounted = new Map(
    summarize(
      DPS.replace(
        "</vServPrest>",
        "</vServPrest><vDescCondIncond><vDescIncond>1000.00</vDescIncond></vDescCondIncond>",
      ),
    ).slice(6),
  );
  assert.equal(discounted.get("valores › vDescCondIncond › vDescIncond"), "1000.00");
  assert.throws(() => summarize(DPS.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>")), /restrita/);
});

const APPROVAL_KEY = "a".repeat(32);
const approvals = () =>
  createApprovals({
    name: "NFSE_APPROVAL_HASH",
    hash: createHash("sha256").update(APPROVAL_KEY).digest("hex"),
    url: "https://nfse.example.com",
  });

const connect = async (server) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const agent = new Client({ name: "test", version: "0" });
  await agent.connect(clientSide);
  return agent;
};
const result = (answer) => JSON.parse(answer.content[0].text);

// The owner approves on the page: here, the same form post the page sends, from the page's own origin. Returns the
// page that answers it.
async function ownerApproves(gate, link) {
  const page = new URL(link);
  const req = Object.assign(
    [new URLSearchParams({ key: APPROVAL_KEY, decision: "approve" }).toString()],
    {
      url: page.pathname,
      method: "POST",
      headers: { origin: page.origin, host: page.host },
    },
  );
  let html = "";
  const res = { writeHead: () => res, end: (body) => (html = String(body ?? "")) };
  assert.ok(await gate.handle(req, res));
  return html;
}

test("the issuing tools appear only with issuing on, and only with the owner's approvals", async () => {
  const adn = adnClient(guard(client(), { issue: true }));
  const readOnlyAgent = await connect(buildServer(adnClient(guard(client())), undefined));
  assert.deepEqual(
    (await readOnlyAgent.listTools()).tools.map((t) => t.name),
    ["list_invoices", "read_skill"],
  );
  await readOnlyAgent.close();

  assert.throws(
    () => buildServer(adn, undefined, sefinClient(client(), certificate), approvals()),
    /guarded fetch/,
  );
  assert.throws(() => buildServer(adn, undefined, sefin()), /owner's approvals/);
  const agent = await connect(buildServer(adn, undefined, sefin(), approvals()));
  const { tools } = await agent.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["list_invoices", "read_skill", "prepare_invoice", "get_approval", "find_invoice"],
  );
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
  await agent.close();
});

test("approving on the page sends only the DPS the owner read, once", async () => {
  const gate = approvals();
  const agent = await connect(
    buildServer(adnClient(guard(client(), { issue: true })), undefined, sefin(), gate),
  );
  const before = requests.length;
  const prepared = result(
    await agent.callTool({ name: "prepare_invoice", arguments: { dps: DPS } }),
  );
  assert.equal(prepared.id, ID);
  assert.match(prepared.link, /^https:\/\/nfse\.example\.com\/approve\/[\w-]{32}$/);

  const status = async (approval) =>
    result(await agent.callTool({ name: "get_approval", arguments: { approval } }));
  assert.deepEqual(await status(prepared.approval), { status: "pending" });
  // The old way, sending from the agent, is gone.
  const withDps = await agent.callTool({ name: "issue_invoice", arguments: { dps: DPS } });
  assert.ok(withDps.isError);
  assert.equal(requests.length, before);

  reply = issued();
  const page = await ownerApproves(gate, prepared.link);
  assert.match(page, new RegExp(`Feito[\\s\\S]*${KEY}`));
  const { status: done, result: invoice } = await status(prepared.approval);
  assert.equal(done, "done");
  assert.deepEqual([invoice.dpsId, invoice.accessKey], [ID, KEY]);
  assert.equal(requests.length, before + 1);
  const sent = gunzipSync(Buffer.from(JSON.parse(requests.at(-1).body).dpsXmlGZipB64, "base64"));
  assert.match(sent.toString(), /<vServ>1500\.50<\/vServ>/);
  await ownerApproves(gate, prepared.link);
  assert.equal(requests.length, before + 1);
  await agent.close();
});

test("a failure answers with only its status and codes", async () => {
  const gate = approvals();
  const agent = await connect(
    buildServer(adnClient(guard(client(), { issue: true })), undefined, sefin(), gate),
  );
  const { approval, link } = result(
    await agent.callTool({ name: "prepare_invoice", arguments: { dps: DPS } }),
  );
  reply = [400, { erros: [{ Codigo: "E0014", Descricao: "CNPJ 00000000000191" }] }];
  const page = await ownerApproves(gate, link);
  assert.match(page, /HTTP 400 E0014/);
  assert.doesNotMatch(page, /00000000000191/);
  assert.deepEqual(
    result(await agent.callTool({ name: "get_approval", arguments: { approval } })),
    { status: "failed", error: "HTTP 400 E0014" },
  );
  const refused = await agent.callTool({
    name: "prepare_invoice",
    arguments: { dps: DPS.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>") },
  });
  assert.match(refused.content[0].text, /produção restrita/);
  await agent.close();
});
