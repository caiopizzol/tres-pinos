// The ADN client and its guard, against a fake ADN that, like the real one, accepts only a client certificate
// signed by its CA. The certificates are made here, with fictional names; the invoice is packages/nfse's fixture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { certificateFetch } from "@tres-pinos/api";
import { certificates, fakeApi } from "@tres-pinos/testing";
import { AdnError, adnClient, API_URL } from "../src/adn.mjs";
import { readOnly } from "../src/guard.mjs";
import { buildServer } from "../src/tools.mjs";

const certs = certificates({
  server: "/CN=localhost",
  owner: "/CN=EMPRESA FICTICIA LTDA:00000000000191",
});

const XML = readFileSync(new URL("../../../packages/nfse/fixtures/nfse.xml", import.meta.url));
const KEY = "41069022200000000000191000000000000126090000000001";
const nfse = (nsu, xml = XML) => ({
  NSU: nsu,
  ChaveAcesso: KEY,
  TipoDocumento: "NFSE",
  ArquivoXml: gzipSync(xml).toString("base64"),
  DataHoraGeracao: "2026-09-02T10:15:00",
});
const cancellation = (nsu) => ({
  NSU: nsu,
  ChaveAcesso: KEY,
  TipoDocumento: "EVENTO",
  TipoEvento: "CANCELAMENTO",
  ArquivoXml: gzipSync("<evento/>").toString("base64"),
  DataHoraGeracao: "2026-09-03T09:00:00",
});
const found = (...records) => [
  200,
  { StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: records, Alertas: [], Erros: [] },
];
// What the real ADN answers past the last document.
const NONE = [
  404,
  {
    StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO",
    LoteDFe: null,
    Erros: [{ Codigo: "E2220", Descricao: "Nenhum documento localizado" }],
  },
];

// The fake answers each request with `reply`.
let reply = null;
const fake = fakeApi(certs, () => reply);
const { requests } = fake;
beforeEach(() => {
  reply = NONE;
});

// The real client, pointed at the fake: the ADN's host is rewritten to it, and the fake's CA is trusted.
function client() {
  const real = certificateFetch({ ...certs.identity("owner"), ca: certs.read("ca.crt") });
  return (url, init) => real(url.replace(new URL(API_URL).origin, fake.url()), init);
}
const adn = () => adnClient(readOnly(client()));

test("lists a batch after an NSU, reading each NFS-e, with the company's e-CNPJ", async () => {
  reply = found(nfse(5), cancellation(7));
  assert.deepEqual(await adn().listDocuments(4), {
    documents: [
      {
        nsu: 5,
        type: "NFSE",
        version: "1.01",
        accessKey: KEY,
        number: "1",
        generationCode: "100",
        generatedAt: "2026-09-02T10:15:00-03:00",
        dpsIssuedAt: "2026-09-02T10:00:00-03:00",
        competence: "2026-08-31",
        issuer: { idType: "CNPJ", id: "00000000000191", name: "EMPRESA FICTICIA LTDA" },
        provider: { idType: "CNPJ", id: "00000000000191", name: null },
        recipient: { idType: "CPF", id: "00000000191", name: "FULANO & FILHOS" },
        serviceCode: "010101",
        description: "Desenvolvimento de software & manutenção",
        serviceAmountCents: 150050,
        unconditionalDiscountCents: 0,
        netAmountCents: 145050,
      },
      // An event is listed, not read, so it never stops the listing.
      { nsu: 7, type: "EVENTO", eventType: "CANCELAMENTO", accessKey: KEY },
    ],
    lastNsu: 7,
    done: false,
  });
  assert.deepEqual(requests.at(-1), {
    method: "GET",
    path: "/contribuintes/DFe/4?lote=true",
    body: "",
    auth: undefined,
    client: "EMPRESA FICTICIA LTDA:00000000000191",
  });
});

test("past the last document, it is done and stays at the same NSU", async () => {
  assert.deepEqual(await adn().listDocuments(104), { documents: [], lastNsu: 104, done: true });
  // A 404 that isn't the ADN saying there's nothing new is a failure, not an empty list.
  for (const body of [{}, "not json", { StatusProcessamento: "REJEICAO" }]) {
    reply = [404, body];
    await assert.rejects(adn().listDocuments(0), /HTTP 404/, JSON.stringify(body));
  }
});

test("never guesses: a document it can't trust fails the whole batch", async () => {
  const at = XML.indexOf("Desenvolvimento de software");
  const broken = Buffer.concat([XML.subarray(0, at), Buffer.from([0xff]), XML.subarray(at + 1)]);
  const cases = [
    [found(nfse(4)), /invalid NSU/],
    [found(nfse(3)), /invalid NSU/],
    [found({ ...nfse(5), NSU: "5" }), /invalid NSU/],
    [found(nfse(5), nfse(5)), /NSU twice/],
    [found({ ...nfse(5), ChaveAcesso: "1" }), /invalid document/],
    [found({ ...nfse(5), TipoDocumento: undefined }), /invalid document/],
    [found({ ...cancellation(5), TipoEvento: "x y" }), /invalid document/],
    [found({ ...nfse(5), ChaveAcesso: KEY.replace(/1$/, "2") }), /different access key/],
    [found({ ...nfse(5), ArquivoXml: "not gzip" }), /unreadable file/],
    [found({ ...nfse(5), ArquivoXml: undefined }), /unreadable file/],
    // Over 1 MB unpacked, though small packed.
    [found(nfse(5, Buffer.alloc(1_000_001, " "))), /unreadable file/],
    // A byte that is never UTF-8, inside the description: read, it would become a different character.
    [found(nfse(5, broken)), /unreadable file/],
    [found(nfse(5, Buffer.from("<x/>"))), /national layout/],
    [found(), /no documents/],
    [[200, { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" }], /no documents/],
    [[200, "not json"], /HTTP 200/],
    [[400, { StatusProcessamento: "REJEICAO", Erros: [{ Descricao: "CNPJ 1234" }] }], /HTTP 400/],
  ];
  for (const [answer, message] of cases) {
    reply = answer;
    await assert.rejects(adn().listDocuments(4), message, String(message));
  }
  for (const nsu of [-1, 1.5, "4", Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(adn().listDocuments(nsu), /not an NSU/, String(nsu));
});

test("the ADN refuses a client with no certificate", async () => {
  await assert.rejects(certificateFetch({ ca: certs.read("ca.crt") })(`${fake.url()}/DFe/0`));
});

test("the guard lets out only the next batch, before the network", async () => {
  const before = requests.length;
  const fetch = readOnly(() => assert.fail("reached the network"));
  for (const [url, init] of [
    [`${API_URL}/DFe/0?lote=true`, { method: "POST" }],
    [`${API_URL}/DFe/0`, {}],
    [`${API_URL}/DFe/0?lote=false`, {}],
    [`${API_URL}/DFe/0?lote=true&cnpjConsulta=00000000000191`, {}],
    [`${API_URL}/DFe/-1?lote=true`, {}],
    [`${API_URL}/NFSe/${KEY}/Eventos`, {}],
    ["https://sefin.nfse.gov.br/SefinNacional/nfse", { method: "POST" }],
    [`https://elsewhere.example/contribuintes/DFe/0?lote=true`, {}],
  ])
    await assert.rejects(fetch(url, init), /Refused/, url);
  assert.equal(requests.length, before);
});

test("the guard refuses a redirect instead of following it", async () => {
  reply = [302, {}];
  await assert.rejects(adn().listDocuments(0), /Refused a 302 redirect/);
});

test("the tool won't run on a fetch the guard didn't wrap", () => {
  assert.throws(() => buildServer(adnClient(client())), /readOnly/);
  buildServer(adn());
});

test("an error carries the ADN's status, never its message text", async () => {
  reply = [500, { Erros: [{ Descricao: "CNPJ 00000000000191" }] }];
  const error = await adn()
    .listDocuments(0)
    .catch((e) => e);
  assert.ok(error instanceof AdnError);
  assert.equal(error.message, "ADN request failed (HTTP 500)");
});

test("the tool asks for the batch after the NSU it is given, and answers a failure with only the status", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(adn()).connect(serverSide);
  const agent = new Client({ name: "test", version: "0" });
  await agent.connect(clientSide);
  const call = (afterNsu) => agent.callTool({ name: "list_invoices", arguments: { afterNsu } });

  reply = found(cancellation(8));
  const listed = await call(7);
  assert.equal(requests.at(-1).path, "/contribuintes/DFe/7?lote=true");
  assert.deepEqual(JSON.parse(listed.content[0].text).documents, [
    { nsu: 8, type: "EVENTO", eventType: "CANCELAMENTO", accessKey: KEY },
  ]);

  reply = [500, { Erros: [{ Descricao: "CNPJ 00000000000191" }] }];
  assert.deepEqual(await call(0), {
    isError: true,
    content: [{ type: "text", text: "NFS-e: HTTP 500" }],
  });
  reply = found(nfse(5, Buffer.from("<x/>")));
  assert.deepEqual((await call(0)).content, [{ type: "text", text: "NFS-e: unavailable" }]);
  await agent.close();
});
