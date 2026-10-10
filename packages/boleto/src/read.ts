// Read every payment code in a PDF or an image, and say where each was found.
import { readFile } from "node:fs/promises";
import { findBoletos, parseCode } from "./boleto.ts";
import { decode } from "./image.ts";
import { checkPages, pageImages, pageTexts, unlock } from "./pdf.ts";
import { findPixCodes, parsePix } from "./pix.ts";

export type Source = { via: "text" | "barcode" | "qr"; page: number };

export type Code =
	| {
			kind: "boleto" | "arrecadacao";
			barcode: string;
			line: string | null;
			amountCents: number | null;
			dueDate: string | null;
			status: Status;
			sources: Source[];
	  }
	| {
			kind: "pix";
			payload: string;
			amountCents: number | null;
			dynamic: boolean;
			status: Status;
			sources: Source[];
	  };

/**
 * `confirmed`: a Pix payload (its CRC16 check), a printed line with all its check digits, or
 * two sources that read the same code. A barcode image alone has one check digit, so it stays
 * unconfirmed.
 */
export type Status = "confirmed" | "unconfirmed";

/** `locked`: a PDF that none of the passwords opens, so it was not read. */
export type Result = {
	type: "pdf" | "image" | "unsupported";
	locked: boolean;
	codes: Code[];
};

const cents = (amount: string | null) =>
	amount === null ? null : Number(amount.replace(".", ""));

const startsWith = (bytes: Uint8Array, signature: number[]) =>
	signature.every((byte, index) => bytes[index] === byte);

function kindOf(bytes: Uint8Array): Result["type"] {
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
	if (
		startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
		startsWith(bytes, [0xff, 0xd8, 0xff]) // JPEG
	)
		return "image";
	return "unsupported";
}

export async function read(
	path: string,
	reference = new Date(),
	passwords: string[] = [],
): Promise<Result> {
	const bytes = new Uint8Array(await readFile(path));
	const type = kindOf(bytes);
	const codes = new Map<string, Code>();
	const add = (key: string, code: Code, source: Source) => {
		const existing = codes.get(key) ?? code;
		if (
			!existing.sources.some(
				(seen) => seen.via === source.via && seen.page === source.page,
			)
		)
			existing.sources.push(source);
		if (code.kind !== "pix" && existing.kind !== "pix")
			existing.line ??= code.line;
		codes.set(key, existing);
	};

	const fromBoleto = (digits: string, source: Source) => {
		const found = parseCode(digits, reference);
		if (!found.valid) return;
		add(
			found.barcode,
			{
				kind: found.kind,
				barcode: found.barcode,
				line: found.line ?? null,
				amountCents: cents(found.amount),
				dueDate: found.kind === "boleto" ? found.dueDate : null,
				status: "unconfirmed",
				sources: [],
			},
			source,
		);
	};
	const fromPix = (payload: string, source: Source) => {
		const found = parsePix(payload);
		if (!found.valid) return;
		add(
			found.payload,
			{
				kind: "pix",
				payload: found.payload,
				amountCents: cents(found.amount),
				dynamic: found.dynamic,
				status: "unconfirmed",
				sources: [],
			},
			source,
		);
	};

	const scanImage = async (image: Uint8Array, page: number) => {
		for (const symbol of await decode(image)) {
			if (symbol.format === "ITF")
				fromBoleto(symbol.text, { via: "barcode", page });
			else fromPix(symbol.text, { via: "qr", page });
		}
	};

	if (type === "pdf") {
		const pdf = await unlock(path, passwords);
		if (pdf === null) return { type, locked: true, codes: [] };
		await checkPages(pdf);
		const texts = await pageTexts(pdf);
		texts.forEach((text, index) => {
			for (const found of findBoletos(text, reference))
				if (found.valid)
					fromBoleto(found.line ?? found.barcode, {
						via: "text",
						page: index + 1,
					});
			for (const found of findPixCodes(text))
				if (found.valid)
					fromPix(found.payload, { via: "text", page: index + 1 });
		});
		const images = await pageImages(pdf);
		for (const [index, image] of images.entries())
			await scanImage(image, index + 1);
	} else if (type === "image") {
		await scanImage(bytes, 1);
	}

	for (const code of codes.values()) {
		const vias = new Set(code.sources.map((source) => source.via));
		code.status =
			code.kind === "pix" || code.line !== null || vias.size > 1
				? "confirmed"
				: "unconfirmed";
	}
	return { type, locked: false, codes: [...codes.values()] };
}
