// Generate synthetic fixture PDFs. Every code is fabricated; no real bill data.
// Run: bun scripts/make-fixtures.ts  (writes to fixtures/)
import { createCipheriv, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boletoMod11, mod10 } from "../src/boleto.ts";
import { crc16 } from "../src/pix.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const PADDING = Buffer.from(
	"28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
	"hex",
);
const md5 = (...parts: Buffer[]) =>
	createHash("md5").update(Buffer.concat(parts)).digest();
const rc4 = (key: Buffer, data: Buffer) => {
	const cipher = createCipheriv("rc4", key, null);
	return Buffer.concat([cipher.update(data), cipher.final()]);
};
const padded = (password: string) =>
	Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);

// PDF standard security handler, revision 2 (40-bit RC4), as real bills use.
// A fixed file ID keeps the output identical on every run.
function security(user: string, owner: string) {
	const id = md5(Buffer.from("boleto-reader fixture"));
	const permissions = Buffer.alloc(4);
	permissions.writeInt32LE(-4);
	const o = rc4(md5(padded(owner)).subarray(0, 5), padded(user));
	const key = md5(padded(user), o, permissions, id).subarray(0, 5);
	return {
		dictionary: `<< /Filter /Standard /V 1 /R 2 /O <${o.toString("hex")}> /U <${rc4(key, PADDING).toString("hex")}> /P -4 >>`,
		id: id.toString("hex"),
		encrypt: (object: number, data: Buffer) => {
			const number = Buffer.alloc(5); // object number, then generation 0
			number.writeUIntLE(object, 0, 3);
			return rc4(md5(key, number).subarray(0, 10), data);
		},
	};
}

// Minimal single-font text PDF: one page per entry, one line per string.
function pdf(
	pages: string[][],
	passwords?: { user: string; owner: string },
): Buffer {
	const lock = passwords && security(passwords.user, passwords.owner);
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	];
	const kids: string[] = [];
	for (const lines of pages) {
		const text = lines
			.map((line) => `(${line.replace(/[\\()]/g, "\\$&")}) '`)
			.join("\n");
		const plain = Buffer.from(
			`BT /F1 10 Tf 40 800 Td 14 TL\n${text}\nET`,
			"latin1",
		);
		const stream = lock ? lock.encrypt(objects.length + 1, plain) : plain;
		objects.push(
			`<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`,
		);
		const contents = objects.length;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`,
		);
		kids.push(`${objects.length} 0 R`);
	}
	objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
	if (lock) objects.push(lock.dictionary);
	const encryption = lock
		? ` /Encrypt ${objects.length} 0 R /ID [<${lock.id}> <${lock.id}>]`
		: "";
	let out = "%PDF-1.4\n";
	const offsets = objects.map((body, index) => {
		const offset = out.length;
		out += `${index + 1} 0 obj\n${body}\nendobj\n`;
		return offset;
	});
	const xref = out.length;
	out +=
		`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
		offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
		`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption} >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

function boletoLine(
	bank: string,
	factor: string,
	cents: string,
	free: string,
): string {
	const body = `${bank}9${factor}${cents}${free}`;
	const barcode = body.slice(0, 4) + boletoMod11(body) + body.slice(4);
	const field = (s: string) => s + mod10(s);
	const a = field(barcode.slice(0, 4) + barcode.slice(19, 24));
	const b = field(barcode.slice(24, 34));
	const c = field(barcode.slice(34, 44));
	return `${a.slice(0, 5)}.${a.slice(5)} ${b.slice(0, 5)}.${b.slice(5)} ${c.slice(0, 5)}.${c.slice(5)} ${barcode[4]} ${barcode.slice(5, 19)}`;
}

function pix(amount: string): string {
	const f = (id: string, value: string) =>
		id + String(value.length).padStart(2, "0") + value;
	const body =
		f("00", "01") +
		f(
			"26",
			f("00", "BR.GOV.BCB.PIX") + f("25", "pix.example.com/qr/v2/cobv/0000"),
		) +
		f("52", "0000") +
		f("53", "986") +
		f("54", amount) +
		f("58", "BR") +
		f("59", "LOJA TESTE") +
		f("60", "SAO PAULO") +
		f("62", f("05", "***")) +
		"6304";
	return body + crc16(body);
}

const line = boletoLine("999", "1500", "0000012345", "1".repeat(25));
const pixCode = pix("123.45");
// Factor 1500 is 2026-07-07 in the current cycle. The Pix payload wraps, as in real PDFs.
const boleto = [
	[
		"BOLETO DE TESTE - DOCUMENTO FICTICIO",
		"",
		`999-9   ${line}`,
		"Beneficiario: Empresa Ficticia Ltda",
		"Vencimento: 07/07/2026   Valor: R$ 123,45",
		"",
		"PIX copia e cola:",
		pixCode.slice(0, 80),
		pixCode.slice(80),
	],
	["Pagina 2: instrucoes ficticias"],
];
const fixtures = {
	"boleto.pdf": pdf(boleto),
	// Opens only with the password 1234, like bills locked with part of the payer's CPF.
	"locked.pdf": pdf(boleto, { user: "1234", owner: "owner" }),
	// Opens without a password, but not with a wrong one.
	"permissions-only.pdf": pdf(boleto, { user: "", owner: "owner" }),
	"no-codes.pdf": pdf([
		["Documento sem codigo de pagamento.", "Apenas texto ficticio."],
	]),
	"bad-check-digit.pdf": pdf([
		[
			`999-9   ${line.replace(/\d(?=\s\d{14}$)/, (d) => String((Number(d) + 1) % 10))}`,
		],
	]),
	// 400 distinct boletos over 10 pages: the JSON is larger than a 64 KiB pipe buffer.
	"many-codes.pdf": pdf(
		Array.from({ length: 10 }, (_, page) =>
			Array.from({ length: 40 }, (_, row) =>
				boletoLine(
					"999",
					"1500",
					"0000012345",
					String(page * 40 + row).padStart(25, "0"),
				),
			),
		),
	),
};

for (const [name, bytes] of Object.entries(fixtures))
	writeFileSync(join(out, name), bytes);
console.log(Object.keys(fixtures).join("\n"));
