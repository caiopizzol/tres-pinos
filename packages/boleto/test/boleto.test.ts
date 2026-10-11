import assert from "node:assert/strict";
import test from "node:test";
import {
  arrecadacaoMod11,
  type BoletoCode,
  boletoMod11,
  dueDateFromFactor,
  findBoletos,
  mod10,
  parseCode,
} from "../src/boleto.ts";

// Build a valid 44-digit boleto barcode and its 47-digit line from the fields.
function boleto({
  bank = "341",
  factor = "1234",
  cents = "0000015050",
  free = "1".repeat(25),
} = {}) {
  const body = `${bank}9${factor}${cents}${free}`;
  const barcode = body.slice(0, 4) + boletoMod11(body) + body.slice(4);
  const field = (s: string) => s + mod10(s);
  const line =
    field(barcode.slice(0, 4) + barcode.slice(19, 24)) +
    field(barcode.slice(24, 34)) +
    field(barcode.slice(34, 44)) +
    barcode.slice(4, 5) +
    barcode.slice(5, 19);
  return { barcode, line };
}

// Build a valid arrecadação barcode (value mode 6, module 10) and its 48-digit line.
function arrecadacao(cents = "00000012345") {
  const body = `826${cents}${"0".repeat(29)}`;
  const barcode = body.slice(0, 3) + mod10(body) + body.slice(3);
  let line = "";
  for (let i = 0; i < 44; i += 11)
    line += barcode.slice(i, i + 11) + mod10(barcode.slice(i, i + 11));
  return { barcode, line };
}

const errorOf = (code: BoletoCode) => (code.valid ? null : code.error);
const alter = (text: string, index: number) =>
  text.slice(0, index) + ((Number(text[index]) + 1) % 10) + text.slice(index + 1);

test("FEBRABAN worked examples", () => {
  assert.equal(mod10("01230067896"), 3); // spec: sum 37, DAC 3
  assert.equal(arrecadacaoMod11("01230067896"), 0); // spec: remainder 0 → DAC 0
});

test("boleto line and barcode decode to the same validated fields", () => {
  const { barcode, line } = boleto();
  const fromLine = parseCode(line, new Date("2026-09-24"));
  assert.ok(fromLine.valid && fromLine.kind === "boleto");
  assert.equal(fromLine.barcode, barcode);
  assert.equal(fromLine.bank, "341");
  assert.equal(fromLine.amount, "150.50");
  const fromBarcode = parseCode(barcode, new Date("2026-09-24"));
  assert.ok(fromBarcode.valid);
  assert.equal(fromBarcode.barcode, barcode);
});

test("due date uses the factor cycle nearest the reference date", () => {
  assert.equal(dueDateFromFactor(1000, new Date("2026-09-24")), "2025-02-22");
  assert.equal(dueDateFromFactor(1000, new Date("2001-01-01")), "2000-07-03");
  assert.equal(dueDateFromFactor(0), null);
});

test("one wrong digit fails the boleto check digits", () => {
  const { line } = boleto();
  assert.equal(parseCode(alter(line, 40)).valid, false);
  assert.equal(errorOf(parseCode(alter(line, 5))), "line_check_digit");
});

test("arrecadação line is validated block by block", () => {
  const { barcode, line } = arrecadacao();
  const parsed = parseCode(line);
  assert.ok(parsed.valid && parsed.kind === "arrecadacao");
  assert.equal(parsed.barcode, barcode);
  assert.equal(parsed.amount, "123.45");
  assert.equal(errorOf(parseCode(alter(line, 13))), "line_check_digit");
});

test("unsupported lengths are reported, not guessed", () => {
  assert.deepEqual(parseCode("123"), {
    kind: "unknown",
    valid: false,
    error: "unsupported_length",
    length: 3,
  });
});

test("findBoletos extracts formatted lines from document text and ignores Pix", () => {
  const { line } = boleto();
  const { barcode: utility } = arrecadacao();
  const formatted =
    `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ` +
    `${line.slice(21, 26)}.${line.slice(26, 32)} ${line[32]} ${line.slice(33)}`;
  const text = `Banco 341-7   ${formatted}\nCodigo de barras: ${utility}\nPIX: 000201010211\n`;
  const codes = findBoletos(text, new Date("2026-09-24"));
  assert.deepEqual(
    codes.map((c) => [c.kind, c.valid]),
    [
      ["boleto", true],
      ["arrecadacao", true],
    ],
  );
});
