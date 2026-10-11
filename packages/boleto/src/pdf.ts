// PDF text and page images through poppler (pdftotext, pdftoppm), after qpdf decrypts the PDF.
// Every input, passwords included, goes through stdin, so none appears in the process list.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Sees every command run, so tests can check that no password is ever an argument. */
export const observe: { command?: (command: string[]) => void } = {};

// Bills seen so far have at most 6 pages. A file from a stranger could have thousands, and each
// page is rendered at 300 DPI, so refuse instead of reading part of it.
export const MAX_PAGES = 20;

function run(
	command: string[],
	input: Uint8Array | string,
): Promise<Uint8Array> {
	observe.command?.(command);
	return new Promise((resolve, reject) => {
		const [file, ...args] = command;
		const options = {
			encoding: "buffer" as const,
			maxBuffer: 256e6,
			timeout: 60_000,
			killSignal: "SIGKILL" as const,
		};
		const child = execFile(file, args, options, (error, stdout, stderr) =>
			error
				? reject(new Error(stderr.toString().trim() || `${file} failed`))
				: resolve(new Uint8Array(stdout)),
		);
		// A tool that exits early closes stdin; without a listener the write error would crash the process.
		child.stdin?.on("error", () => {});
		child.stdin?.end(input);
	});
}

/**
 * The PDF decrypted with the first password that opens it, trying none first: a PDF with only a
 * permissions password opens without one but not with a wrong one. `null` when none opens it.
 */
export async function unlock(
	path: string,
	passwords: string[],
): Promise<Uint8Array | null> {
	for (const password of ["", ...passwords]) {
		try {
			return await run(
				[
					"qpdf",
					"--password-file=-",
					"--decrypt",
					"--warning-exit-0",
					path,
					"-",
				],
				password,
			);
		} catch (error) {
			// qpdf ends its rejection with ": invalid password"; the filename it names can contain the phrase too.
			if (!String(error).endsWith(": invalid password")) throw error;
		}
	}
	return null;
}

/**
 * Refuses a PDF with more than MAX_PAGES by asking poppler for the page after the limit, which
 * fails when there is none. pdfinfo's page count can't be trusted: a title can add a "Pages:" line.
 */
export async function checkPages(pdf: Uint8Array): Promise<void> {
	const after = String(MAX_PAGES + 1);
	try {
		await run(["pdftotext", "-f", after, "-l", after, "-", "/dev/null"], pdf);
	} catch (error) {
		if (/Wrong page range/.test(String(error))) return;
		throw error;
	}
	throw new Error(`PDF has more than ${MAX_PAGES} pages`);
}

/** The text of each page, in order. */
export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
	const text = new TextDecoder().decode(
		await run(["pdftotext", "-layout", "-", "-"], pdf),
	);
	// pdftotext ends every page with a form feed, so the last piece is empty.
	return text.split("\f").slice(0, -1);
}

/** Each page as a 300 DPI grayscale PNG, the resolution the Pix QR needs. */
export async function pageImages(pdf: Uint8Array): Promise<Uint8Array[]> {
	const dir = await mkdtemp(join(tmpdir(), "boleto-reader-"));
	try {
		await run(
			["pdftoppm", "-r", "300", "-gray", "-png", "-", join(dir, "page")],
			pdf,
		);
		// pdftoppm pads page numbers, so names sort in page order.
		const files = (await readdir(dir)).sort();
		return await Promise.all(
			files.map(
				async (file) => new Uint8Array(await readFile(join(dir, file))),
			),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
