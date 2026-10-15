// Issuing in produção restrita, against a fake national system that, like the real one, accepts only a client
// certificate signed by its CA. The certificates are made here, with fictional names; the DPS and the invoice are
// packages/nfse's fixture.
import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { beforeEach, test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validateDpsXml } from "open-nfse";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { certificateFetch } from "@tres-pinos/api";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { adnClient } from "../src/adn.mjs";
import { guard } from "../src/guard.mjs";
import { SEFIN_URL, SefinError, sefinClient } from "../src/sefin.mjs";
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
const issued = (nfse = NFSE) => [
  201,
  { idDps: `NFS${KEY}`, chaveAcesso: KEY, nfseXmlGZipB64: gzipSync(nfse).toString("base64") },
];

let reply = null;
const fake = fakeApi(certs, () => reply);
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

test("an invoice for a different DPS is not taken as this one's", async () => {
  reply = issued(NFSE.toString().replace(ID, "DPS410690220000000000019100001000000000000002"));
  await assert.rejects(sefin().issue(DPS), /different DPS/);
});

test("find tells whether a DPS generated an invoice", async () => {
  assert.deepEqual(await sefin().find(ID), { dpsId: ID, issued: false });
  assert.equal(requests.at(-1).path, `/SefinNacional/dps/${ID}`);
  reply = [200, { chaveAcesso: KEY }];
  assert.deepEqual(await sefin().find(ID), { dpsId: ID, issued: true, accessKey: KEY });
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
    [`${SEFIN_URL}/nfse/${KEY}`, {}],
    [`${SEFIN_URL}/nfse`, { method: "PUT" }],
    [`${SEFIN_URL}/dps/${ID}`, { method: "POST" }],
    [`${SEFIN_URL}/dps/DPS1`, {}],
  ])
    await assert.rejects(on(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the issuing tools appear only with issuing on, and answer a failure with only its status and codes", async () => {
  const adn = adnClient(guard(client(), { issue: true }));
  const names = async (server) => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const agent = new Client({ name: "test", version: "0" });
    await agent.connect(clientSide);
    return agent;
  };
  const readOnlyAgent = await names(buildServer(adnClient(guard(client())), undefined));
  assert.deepEqual(
    (await readOnlyAgent.listTools()).tools.map((t) => t.name),
    ["list_invoices"],
  );
  await readOnlyAgent.close();

  assert.throws(
    () => buildServer(adn, undefined, sefinClient(client(), certificate)),
    /guarded fetch/,
  );
  const agent = await names(buildServer(adn, undefined, sefin()));
  const { tools } = await agent.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["list_invoices", "prepare_invoice", "issue_invoice", "find_invoice"],
  );
  assert.equal(tools.find((t) => t.name === "issue_invoice").annotations.readOnlyHint, false);

  reply = [400, { erros: [{ Codigo: "E0014", Descricao: "CNPJ 00000000000191" }] }];
  assert.deepEqual(await agent.callTool({ name: "issue_invoice", arguments: { dps: DPS } }), {
    isError: true,
    content: [{ type: "text", text: "NFS-e: HTTP 400 E0014" }],
  });
  const refused = await agent.callTool({
    name: "issue_invoice",
    arguments: { dps: DPS.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>") },
  });
  assert.match(refused.content[0].text, /produção restrita/);
  await agent.close();
});
