// readNfse on a fictional invoice that validates against the official 1.01 schema, and on variations of it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NfseError, readNfse } from "../src/nfse.mjs";

const XML = readFileSync(new URL("../fixtures/nfse.xml", import.meta.url), "utf8");
const change = (from, to) => {
  assert.ok(XML.includes(from), from);
  return XML.replace(from, to);
};

test("reads the facts of a national NFS-e", () => {
  assert.deepEqual(readNfse(XML), {
    version: "1.01",
    accessKey: "41069022200000000000191000000000000126090000000001",
    number: "1",
    generationCode: "100",
    generatedAt: "2026-09-02T10:15:00-03:00",
    dpsId: "DPS410690220000000000019100001000000000000001",
    dpsIssuedAt: "2026-09-02T10:00:00-03:00",
    competence: "2026-08-31",
    issuer: { idType: "CNPJ", id: "00000000000191", name: "EMPRESA FICTICIA LTDA" },
    provider: {
      idType: "CNPJ",
      id: "00000000000191",
      name: null,
      municipalRegistration: null,
      simplesNacional: "1",
    },
    recipient: { idType: "CPF", id: "00000000191", name: "FULANO & FILHOS" },
    serviceCode: "010101",
    description: "Desenvolvimento de software & manutenção",
    serviceAmountCents: 150050,
    unconditionalDiscountCents: 0,
    netAmountCents: 145050,
    withholdings: {
      irrfCents: 0,
      cpCents: 0,
      csllCents: 0,
      issqn: "1",
      issqnCents: 0,
      pisCofins: null,
    },
    ibsCbs: null,
    federalTaxPercent: null,
  });
});

// A note whose recipient withheld IRRF 1.5%, CSRF 4.65% (PIS 0.65%, COFINS 3%, CSLL 1%) and ISS 5% of R$ 1.000,00,
// in the order the official 1.01 schema puts each field.
const WITHHELD = change(
  "<vLiq>1450.50</vLiq>",
  "<vISSQN>50.00</vISSQN><vTotalRet>75.00</vTotalRet><vLiq>878.50</vLiq>",
)
  .replace("<vServ>1500.50</vServ>", "<vServ>1000.00</vServ>")
  .replace("<tpRetISSQN>1</tpRetISSQN>", "<tpRetISSQN>2</tpRetISSQN>")
  .replace(
    "</tribMun>",
    "</tribMun><tribFed><piscofins><CST>01</CST><vBCPisCofins>1000.00</vBCPisCofins><pAliqPis>0.65</pAliqPis><pAliqCofins>3.00</pAliqCofins><vPis>6.50</vPis><vCofins>30.00</vCofins><tpRetPisCofins>3</tpRetPisCofins></piscofins><vRetIRRF>15.00</vRetIRRF><vRetCSLL>10.00</vRetCSLL></tribFed>",
  );

test("reads what the note declares as withheld, field by field", () => {
  const note = readNfse(WITHHELD);
  assert.equal(note.serviceAmountCents, 100000);
  assert.equal(note.netAmountCents, 87850);
  assert.deepEqual(note.withholdings, {
    irrfCents: 1500,
    cpCents: 0,
    csllCents: 1000,
    issqn: "2",
    issqnCents: 5000,
    pisCofins: { cst: "01", withholding: "3", pisCents: 650, cofinsCents: 3000 },
  });
});

test("reads the IBS and CBS the national system calculated", () => {
  const group =
    "<IBSCBS><cLocalidadeIncid>4106902</cLocalidadeIncid><xLocalidadeIncid>Curitiba</xLocalidadeIncid>" +
    "<valores><vBC>1500.50</vBC><uf><pIBSUF>0.10</pIBSUF><pAliqEfetUF>0.10</pAliqEfetUF></uf>" +
    "<mun><pIBSMun>0.00</pIBSMun><pAliqEfetMun>0.00</pAliqEfetMun></mun>" +
    "<fed><pCBS>0.90</pCBS><pAliqEfetCBS>0.90</pAliqEfetCBS></fed></valores>" +
    "<totCIBS><vTotNF>1500.50</vTotNF><gIBS><vIBSTot>1.50</vIBSTot><gIBSUFTot><vIBSUF>1.50</vIBSUF></gIBSUFTot>" +
    "<gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>13.50</vCBS></gCBS></totCIBS></IBSCBS>";
  const note = readNfse(change("</valores>\n    <DPS", `</valores>${group}<DPS`));
  assert.deepEqual(note.ibsCbs, { ibsCents: 150, cbsCents: 1350 });
  assert.throws(
    () =>
      readNfse(
        change("</valores>\n    <DPS", `</valores>${group.replace("<vCBS>13.50</vCBS>", "")}<DPS`),
      ),
    /vCBS is missing/,
  );
});

test("reads an unconditional discount, and only that one", () => {
  const discount = (group) =>
    readNfse(change("</vServPrest>", `</vServPrest><vDescCondIncond>${group}</vDescCondIncond>`))
      .unconditionalDiscountCents;
  assert.equal(discount("<vDescIncond>100.25</vDescIncond>"), 10025);
  assert.equal(discount("<vDescCond>50.00</vDescCond>"), 0);
  assert.throws(() => discount("<vDescIncond>1.005</vDescIncond>"), /vDescIncond is not an amount/);
  assert.throws(() => discount("<vDescIncond/>"), /vDescIncond is empty/);
});

test("reads a prefixed namespace, an absent recipient, and a foreign one without a tax ID", () => {
  const prefixed = XML.replaceAll("<", "<n:")
    .replaceAll("<n:/", "</n:")
    .replaceAll("<n:?", "<?")
    .replaceAll("<n:!", "<!")
    .replace(
      'xmlns="http://www.sped.fazenda.gov.br/nfse"',
      'xmlns:n="http://www.sped.fazenda.gov.br/nfse"',
    )
    .replace(/<n:Signature[\s\S]*<\/n:Signature>/, "");
  assert.equal(readNfse(prefixed).recipient.name, "FULANO & FILHOS");

  const percent = change(
    "<indTotTrib>0</indTotTrib>",
    "<pTotTrib><pTotTribFed>7.68</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>0.00</pTotTribMun></pTotTrib>",
  );
  assert.equal(readNfse(percent).federalTaxPercent, "7.68");

  const registered = change("<regTrib>", "<IM>123456</IM><regTrib>");
  assert.equal(readNfse(registered).provider.municipalRegistration, "123456");

  const noRecipient = change(/<toma>[\s\S]*?<\/toma>/.exec(XML)[0], "");
  assert.equal(readNfse(noRecipient).recipient, null);

  const foreign = change("<CPF>00000000191</CPF>", "<cNaoNIF>1</cNaoNIF>");
  assert.deepEqual(readNfse(foreign).recipient, {
    idType: "none",
    noIdReason: "1",
    name: "FULANO & FILHOS",
  });
});

test("never guesses: a missing, repeated or malformed field fails", () => {
  const cases = [
    [change("<vServ>1500.50</vServ>", "<vServ>1500.505</vServ>"), /vServ is not an amount/],
    [change("<vLiq>1450.50</vLiq>", ""), /vLiq is missing/],
    [
      change("<nNFSe>1</nNFSe>", "<nNFSe>1</nNFSe><nNFSe>2</nNFSe>"),
      /nNFSe appears more than once/,
    ],
    [change('Id="NFS', 'Id="NF'), /no valid access key/],
    [change('Id="NFS4', 'Id="NFSX'), /no valid access key/],
    [change('Id="DPS', 'Id="DP'), /infDPS has no valid Id/],
    [change("<opSimpNac>1</opSimpNac>", "<opSimpNac>4</opSimpNac>"), /opSimpNac is not 1, 2 or 3/],
    [
      change(
        "<indTotTrib>0</indTotTrib>",
        "<pTotTrib><pTotTribFed>7,68</pTotTribFed><pTotTribEst>0</pTotTribEst><pTotTribMun>0</pTotTribMun></pTotTrib>",
      ),
      /pTotTribFed is not a percentage/,
    ],
    [change('versao="1.01" xmlns', 'versao="2.00" xmlns'), /version 2.00 is not supported/],
    [change("http://www.sped.fazenda.gov.br/nfse", "http://example.com/nfse"), /national layout/],
    [change("<CPF>00000000191</CPF>", ""), /exactly one of CNPJ, CPF, NIF or cNaoNIF/],
    [
      change("<CPF>00000000191</CPF>", "<CNPJ>00000000000272</CNPJ><CPF>00000000191</CPF>"),
      /exactly one of CNPJ, CPF, NIF or cNaoNIF/,
    ],
    [change("<vLiq>1450.50</vLiq>", "<vLiq><x>1450.50</x></vLiq>"), /vLiq holds elements/],
    [
      WITHHELD.replace("<vRetIRRF>15.00</vRetIRRF>", "<vRetIRRF>15,00</vRetIRRF>"),
      /vRetIRRF is not an amount/,
    ],
    [
      WITHHELD.replace(
        "<vRetCSLL>10.00</vRetCSLL>",
        "<vRetCSLL>10.00</vRetCSLL><vRetCSLL>1.00</vRetCSLL>",
      ),
      /vRetCSLL appears more than once/,
    ],
    [
      change("<tpRetISSQN>1</tpRetISSQN>", "<tpRetISSQN>4</tpRetISSQN>"),
      /tpRetISSQN is not a code/,
    ],
    [
      WITHHELD.replace("<tpRetPisCofins>3</tpRetPisCofins>", "<tpRetPisCofins>X</tpRetPisCofins>"),
      /tpRetPisCofins is not a code/,
    ],
    [XML.slice(0, 400), /not well-formed/],
  ];
  // An NfseError, so the CLI shows its message instead of a stack trace.
  for (const [xml, message] of cases)
    assert.throws(
      () => readNfse(xml),
      (error) => error instanceof NfseError && message.test(error.message),
      String(message),
    );
  // A field nested deeper than where the layout puts it, or from another namespace, is not the field.
  const nested = change("<vLiq>1450.50</vLiq>", "<extra><vLiq>1450.50</vLiq></extra>");
  assert.throws(() => readNfse(nested), /vLiq is missing/);
  const foreign = change(
    "<vLiq>1450.50</vLiq>",
    '<vLiq xmlns="http://example.com/x">1450.50</vLiq>',
  );
  assert.throws(() => readNfse(foreign), /vLiq is missing/);
});

test("refuses a DOCTYPE and a file too large to be an invoice, before parsing", () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>${XML.slice(XML.indexOf("<NFSe"))}`;
  assert.throws(() => readNfse(bomb), /DOCTYPE/);
  assert.throws(() => readNfse(XML + " ".repeat(1_000_000)), /larger than 1 MB/);
});

const dir = mkdtempSync(join(tmpdir(), "nfse-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = new URL("../src/cli.mjs", import.meta.url).pathname;

test("the CLI prints JSON for an NFS-e, and only an error for anything else", () => {
  const good = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "read", new URL("../fixtures/nfse.xml", import.meta.url).pathname],
      { encoding: "utf8" },
    ),
  );
  assert.equal(good.accessKey, "41069022200000000000191000000000000126090000000001");
  writeFileSync(join(dir, "bad.xml"), "<not-an-nfse/>");
  // Over 1 MB: refused before the file is read.
  writeFileSync(join(dir, "huge.xml"), Buffer.alloc(1_000_001, " "));
  const huge = spawnSync(process.execPath, [cli, "read", join(dir, "huge.xml")], {
    encoding: "utf8",
  });
  assert.match(huge.stderr, /larger than 1 MB/);
  for (const args of [
    ["read", join(dir, "huge.xml")],
    ["read", join(dir, "bad.xml")],
    ["read", join(dir, "missing.xml")],
    ["read"],
  ]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(run.status, 1, args.join(" "));
    assert.equal(run.stdout, "");
    assert.ok(run.stderr.trim());
  }
});
