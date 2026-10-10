import { afterAll, afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { MAX_PAGES, observe, unlock } from "../src/pdf.ts";
import { read } from "../src/read.ts";

prepareZXingModule({
	overrides: {
		wasmBinary: await Bun.file(
			Bun.resolveSync("zxing-wasm/writer/zxing_writer.wasm", import.meta.dir),
		).arrayBuffer(),
	},
});

const fixture = (name: string) =>
	new URL(`../fixtures/${name}`, import.meta.url).pathname;
const reference = new Date("2026-07-01");
const dir = mkdtempSync(join(tmpdir(), "boleto-reader-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
	observe.command = undefined;
});

/** The commands the reader runs from now until the end of the test. */
function recordCommands() {
	const commands: string[][] = [];
	observe.command = (command) => commands.push(command);
	return commands;
}

/** Writes a barcode image the reader should decode, as a phone photo or screenshot would be. */
async function image(text: string, format: "ITF" | "QRCode") {
	const { image, error } = await writeBarcode(text, { format, scale: 4 });
	if (!image) throw new Error(error);
	const path = join(dir, `${format}-${Bun.hash(text)}.png`);
	writeFileSync(path, await image.bytes());
	return path;
}

// The barcode printed as the line in fixtures/boleto.pdf; factor 1500 is 2026-07-07.
const BARCODE = "99993150000000123451111111111111111111111111";

test("a PDF's printed line and its barcode are one confirmed boleto", async () => {
	const { type, codes } = await read(fixture("boleto.pdf"), reference);
	expect(type).toBe("pdf");
	expect(codes).toEqual([
		{
			kind: "boleto",
			barcode: BARCODE,
			line: "99991111161111111111511111111115315000000012345",
			amountCents: 12345,
			dueDate: "2026-07-07",
			status: "confirmed",
			sources: [{ via: "text", page: 1 }],
		},
		expect.objectContaining({
			kind: "pix",
			amountCents: 12345,
			dynamic: true,
			status: "confirmed",
			sources: [{ via: "text", page: 1 }],
		}),
	]);
});

test("a barcode image alone is unconfirmed; a Pix QR is confirmed by its CRC", async () => {
	const boleto = await read(await image(BARCODE, "ITF"), reference);
	expect(boleto.type).toBe("image");
	expect(boleto.codes).toEqual([
		expect.objectContaining({
			kind: "boleto",
			barcode: BARCODE,
			line: null,
			amountCents: 12345,
			status: "unconfirmed",
			sources: [{ via: "barcode", page: 1 }],
		}),
	]);
	const pdf = await read(fixture("boleto.pdf"), reference);
	const payload = pdf.codes.find((code) => code.kind === "pix");
	if (payload?.kind !== "pix") throw new Error("fixture has no Pix");
	const pix = await read(await image(payload.payload, "QRCode"), reference);
	expect(pix.codes).toEqual([
		expect.objectContaining({
			kind: "pix",
			payload: payload.payload,
			status: "confirmed",
			sources: [{ via: "qr", page: 1 }],
		}),
	]);
});

test("a locked PDF is read with the password that opens it, or reported locked", async () => {
	const commands = recordCommands();
	const { codes } = await read(fixture("locked.pdf"), reference, [
		"9999",
		"1234",
	]);
	expect(codes.map((code) => code.kind)).toEqual(["boleto", "pix"]);
	// Other users can read process arguments, so passwords must never be one.
	expect(commands.length).toBeGreaterThan(0);
	expect(
		commands
			.map((command) => command.join(" "))
			.filter((command) => /1234|9999/.test(command)),
	).toEqual([]);
	expect(await read(fixture("locked.pdf"), reference, ["9999"])).toEqual({
		type: "pdf",
		locked: true,
		codes: [],
	});
});

test("a wrong password does not stop a PDF that opens without one", async () => {
	expect(await unlock(fixture("permissions-only.pdf"), ["9999"])).not.toBe(
		null,
	);
});

test("a damaged PDF is an error, not a locked one", async () => {
	const damaged = join(dir, "damaged.pdf");
	writeFileSync(damaged, "%PDF-1.4\ngarbage");
	await expect(read(damaged, reference, ["1234"])).rejects.toThrow();
	// qpdf names the file in every error, so a name containing "invalid password" must not look locked.
	const named = join(dir, "invalid password.pdf");
	writeFileSync(named, "%PDF-1.4\ngarbage");
	await expect(read(named, reference, ["1234"])).rejects.toThrow();
});

test("a PDF with more pages than the limit is refused before any page is rendered", async () => {
	const many = join(dir, "many-pages.pdf");
	execFileSync("qpdf", [
		"--empty",
		"--pages",
		...Array(MAX_PAGES + 1).fill(fixture("no-codes.pdf")),
		"--",
		many,
	]);
	// A title can add a "Pages: 1" line to pdfinfo's output, so append one as an incremental update.
	const base = readFileSync(many, "latin1");
	const last = (pattern: RegExp) => [...base.matchAll(pattern)].at(-1)?.[1];
	const size = Number(last(/\/Size (\d+)/g));
	const info = `${size} 0 obj\n<< /Title (x\\nPages: 1\\nx) >>\nendobj\n`;
	const xref = `xref\n${size} 1\n${String(base.length).padStart(10, "0")} 00000 n \n`;
	const trailer = `trailer\n<< /Size ${size + 1} /Root ${last(/\/Root (\d+ \d+ R)/g)} /Info ${size} 0 R /Prev ${last(/startxref\s+(\d+)/g)} >>\n`;
	const spoofed = join(dir, "spoofed-pages.pdf");
	writeFileSync(
		spoofed,
		`${base}${info}${xref}${trailer}startxref\n${base.length + info.length}\n%%EOF\n`,
		"latin1",
	);

	for (const path of [many, spoofed]) {
		const commands = recordCommands();
		await expect(read(path, reference)).rejects.toThrow(
			`PDF has more than ${MAX_PAGES} pages`,
		);
		expect(commands.some(([tool]) => tool === "pdftoppm")).toBe(false);
	}
});

test("invalid codes and unknown files return no codes", async () => {
	expect((await read(fixture("no-codes.pdf"), reference)).codes).toEqual([]);
	expect((await read(fixture("bad-check-digit.pdf"), reference)).codes).toEqual(
		[],
	);
	// One wrong digit in the barcode fails its check digit.
	const wrong = `${BARCODE.slice(0, 20)}9${BARCODE.slice(21)}`;
	expect((await read(await image(wrong, "ITF"), reference)).codes).toEqual([]);
	const heic = join(dir, "photo.heic");
	writeFileSync(heic, "\x00\x00\x00\x18ftypheic");
	expect(await read(heic, reference)).toEqual({
		type: "unsupported",
		locked: false,
		codes: [],
	});
});
