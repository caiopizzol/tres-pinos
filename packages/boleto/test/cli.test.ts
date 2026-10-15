// The CLI's contract, run as a real process: exit 0 when a code is confirmed, 2 when none is, 1 for
// bad arguments or an unreadable file, with the result as JSON on stdout and errors on stderr.
import { expect, setDefaultTimeout, test } from "bun:test";

// Each test starts the CLI, which loads the WASM barcode reader; the locked PDF runs it twice. That nears bun's 5 s
// default on a CI runner.
setDefaultTimeout(20_000);

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

async function run(...args: string[]) {
  return runWith("", ...args);
}

async function runWith(stdin: string, ...args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const USAGE =
  "Usage: boleto-reader read <file> [--reference YYYY-MM-DD] [--password-file <file>]\n";

test("a confirmed code prints the result as JSON and exits 0", async () => {
  const { exitCode, stdout, stderr } = await run(
    "read",
    fixture("boleto.pdf"),
    "--reference",
    "2026-07-01",
  );
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const result = JSON.parse(stdout);
  expect(result.type).toBe("pdf");
  expect(
    result.codes.map((code: { kind: string; status: string }) => [code.kind, code.status]),
  ).toEqual([
    ["boleto", "confirmed"],
    ["pix", "confirmed"],
  ]);
  expect(result.codes[0].barcode).toBe("99993150000000123451111111111111111111111111");
});

test("a readable file with no payment code prints an empty result and exits 2", async () => {
  expect(await run("read", fixture("no-codes.pdf"))).toEqual({
    exitCode: 2,
    stdout: `${JSON.stringify({ type: "pdf", locked: false, codes: [] }, null, 2)}\n`,
    stderr: "",
  });
});

test("a line that fails its check digit is dropped, so the CLI exits 2", async () => {
  expect(await run("read", fixture("bad-check-digit.pdf"), "--reference", "2026-07-01")).toEqual({
    exitCode: 2,
    stdout: `${JSON.stringify({ type: "pdf", locked: false, codes: [] }, null, 2)}\n`,
    stderr: "",
  });
});

test("a locked PDF opens with a password from stdin, or prints locked and exits 2", async () => {
  const opened = await runWith(
    "9999\n1234\n",
    "read",
    fixture("locked.pdf"),
    "--password-file",
    "-",
  );
  expect(opened.exitCode).toBe(0);
  expect(JSON.parse(opened.stdout).locked).toBe(false);
  expect(await runWith("9999\n", "read", fixture("locked.pdf"), "--password-file", "-")).toEqual({
    exitCode: 2,
    stdout: `${JSON.stringify({ type: "pdf", locked: true, codes: [] }, null, 2)}\n`,
    stderr: "",
  });
});

test("bad arguments print the usage and exit 1", async () => {
  for (const args of [
    [],
    ["scan", fixture("boleto.pdf")],
    ["read"],
    ["read", fixture("boleto.pdf"), "--reference", "2026-7-1"],
    ["read", fixture("boleto.pdf"), "--date", "2026-07-01"],
  ]) {
    expect(await run(...args)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: USAGE,
    });
  }
});

test("an unreadable file reports the error and exits 1", async () => {
  const { exitCode, stdout, stderr } = await run("read", fixture("missing.pdf"));
  expect({ exitCode, stdout }).toEqual({ exitCode: 1, stdout: "" });
  expect(stderr).toContain("missing.pdf");
});
