// Checks real bills in corpus/ against corpus/expected.json, printing pass or fail and never
// the codes themselves. corpus/ is git-ignored, so private bills stay on this machine.
// Runs under Bun or Node: `bun run corpus`, or `node scripts/corpus.ts` to check the Node runtime.
//
// expected.json: { "<file>": { "reference": "YYYY-MM-DD", "passwords"?: [...], <result as read() returns> } }
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { type Result, read } from "../src/read.ts";

const dir = new URL("../corpus/", import.meta.url).pathname;
const expected: Record<
	string,
	Result & { reference: string; passwords?: string[] }
> = JSON.parse(await readFile(`${dir}expected.json`, "utf8"));

let failed = 0;
for (const [file, { reference, passwords, ...want }] of Object.entries(
	expected,
)) {
	const result = await read(dir + file, new Date(reference), passwords);
	const pass = isDeepStrictEqual(result, want);
	if (!pass) failed++;
	const summary = result.locked
		? "locked"
		: result.codes.map((code) => `${code.kind}:${code.status}`).join(" ");
	console.log(`${pass ? "pass" : "FAIL"}  ${file}  ${summary || "no codes"}`);
}
process.exit(failed ? 1 : 0);
