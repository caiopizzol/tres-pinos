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
    provider: { idType: "CNPJ", id: "00000000000191", name: null, municipalRegistration: null },
    recipient: { idType: "CPF", id: "00000000191", name: "FULANO & FILHOS" },
    serviceCode: "010101",
    description: "Desenvolvimento de software & manutenção",
    serviceAmountCents: 150050,
    unconditionalDiscountCents: 0,
    netAmountCents: 145050,
    federalTaxPercent: null,
  });
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
