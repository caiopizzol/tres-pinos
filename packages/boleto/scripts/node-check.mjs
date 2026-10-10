// Runs the CLI on Node the way a Node caller does, through execFile, and checks it reads a plain
// and a locked PDF, and that a result larger than the 64 KiB pipe buffer arrives whole: Node
// writes to a pipe asynchronously, so exiting early would cut the JSON short. Bun's test runner
// drains pipes too quickly to see that, so this runs under Node, in CI.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";

const cli = (args, stdin = "") =>
	new Promise((resolve) => {
		const child = execFile(
			"node",
			["src/cli.ts", "read", ...args, "--reference", "2026-07-01"],
			{ maxBuffer: 10e6 },
			(error, stdout) => resolve({ code: error?.code ?? 0, stdout }),
		);
		child.stdin.end(stdin);
	});

const plain = await cli(["fixtures/boleto.pdf"]);
assert.equal(plain.code, 0);
assert.deepEqual(
	JSON.parse(plain.stdout).codes.map((code) => code.kind),
	["boleto", "pix"],
);

const locked = await cli(
	["fixtures/locked.pdf", "--password-file", "-"],
	"1234\n",
);
assert.equal(locked.code, 0);
assert.equal(JSON.parse(locked.stdout).locked, false);

const many = await cli(["fixtures/many-codes.pdf"]);
assert.ok(many.stdout.length > 65_536, `${many.stdout.length} bytes`);
assert.equal(JSON.parse(many.stdout).codes.length, 400);

console.log(
	`node ${process.version}: plain, locked and ${many.stdout.length}-byte results ok`,
);
