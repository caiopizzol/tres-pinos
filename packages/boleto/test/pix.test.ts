import assert from "node:assert/strict";
import test from "node:test";
import { crc16, findPixCodes, parsePix } from "../src/pix.ts";

const field = (id: string, value: string) =>
	id + String(value.length).padStart(2, "0") + value;

// Build a Pix BR Code with correct EMV lengths and CRC.
function pix(
	amount: string | null,
	account: [string, string] = ["01", "12345678901"],
) {
	const body =
		field("00", "01") +
		field("26", field("00", "BR.GOV.BCB.PIX") + field(...account)) +
		field("52", "0000") +
		field("53", "986") +
		(amount ? field("54", amount) : "") +
		field("58", "BR") +
		field("59", "LOJA TESTE") +
		field("60", "SAO PAULO") +
		field("62", field("05", "***")) +
		"6304";
	return body + crc16(body);
}

test("CRC16 matches the CCITT-FALSE reference value", () => {
	assert.equal(crc16("123456789"), "29B1");
});

test("Pix payload requires a valid CRC", () => {
	const payload = pix("150.50");
	const parsed = parsePix(payload);
	assert.ok(parsed.valid);
	assert.equal(parsed.merchant, "LOJA TESTE");
	assert.equal(parsed.amount, "150.50");
	assert.equal(parsed.dynamic, false);
	assert.deepEqual(parsePix(`${payload.slice(0, -4)}0000`), {
		kind: "pix",
		valid: false,
		error: "crc",
	});
});

test("dynamic Pix is recognized by its charge URL", () => {
	const parsed = parsePix(pix(null, ["25", "pix.example.com/qr/v2/cobv/0000"]));
	assert.ok(parsed.valid);
	assert.equal(parsed.dynamic, true);
	assert.equal(parsed.amount, null);
});

test("findPixCodes rejoins a payload wrapped across lines", () => {
	const payload = pix("1.00");
	const codes = findPixCodes(
		`PIX copia e cola:\n${payload.slice(0, 60)}\n${payload.slice(60)}\n`,
	);
	assert.deepEqual(
		codes.map((c) => [c.valid, c.valid ? c.amount : null]),
		[[true, "1.00"]],
	);
});

test("a corrupted Pix is reported, not dropped", () => {
	const payload = pix("1.00");
	assert.deepEqual(findPixCodes(`PIX: ${payload.slice(0, -1)}0`), [
		{ kind: "pix", valid: false, error: "crc" },
	]);
	// Control: text without any Pix payload reports nothing.
	assert.deepEqual(findPixCodes("sem pix aqui"), []);
});
