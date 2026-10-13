// What SKILL.md tells the agent about the reader, checked against the reader itself: its path, arguments, exit codes
// and fields. A change to packages/boleto that would break the skill fails here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const REPO = new URL("../../../", import.meta.url).pathname;
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const fixture = (name) => `${REPO}packages/boleto/fixtures/${name}`;

// Runs the reader exactly as the skill's commands do, with TRES_PINOS_DIR set to the repository.
function read(file, password) {
  const command = password === undefined ? commands[0] : commands[1];
  const shell = command
    .replace("conta.pdf", JSON.stringify(file))
    .replace('"SENHA"', `'${password}'`);
  const { status, stdout } = spawnSync("sh", ["-c", shell], {
    env: { ...process.env, TRES_PINOS_DIR: REPO },
  });
  return { exit: status, result: status === 1 ? null : JSON.parse(stdout) };
}
const commands = [...skill.matchAll(/```bash\n(.+)\n```/g)].map((match) => match[1]);

test("the skill has a name and a description, which Claude Code and Codex both need", () => {
  const frontmatter = skill.split("---")[1];
  assert.match(frontmatter, /^name: ler-conta$/m);
  assert.match(frontmatter, /^description: .+$/m);
  assert.equal(commands.length, 2);
});

test("a bill: exit 0, with the type, amount, due date, code and status the skill reports", () => {
  const { exit, result } = read(fixture("boleto.pdf"));
  assert.equal(exit, 0);
  const [boleto, pix] = result.codes;
  assert.deepEqual(
    {
      kind: boleto.kind,
      amountCents: boleto.amountCents,
      dueDate: boleto.dueDate,
      status: boleto.status,
    },
    { kind: "boleto", amountCents: 12345, dueDate: "2026-07-07", status: "confirmed" },
  );
  assert.match(boleto.line, /^\d{47}$/);
  assert.equal(pix.kind, "pix");
  assert.match(pix.payload, /^000201/);
});

test("a locked PDF: locked, and it opens with the password through standard input", () => {
  assert.deepEqual(read(fixture("locked.pdf")), {
    exit: 2,
    result: { type: "pdf", locked: true, codes: [] },
  });
  const opened = read(fixture("locked.pdf"), "1234");
  assert.equal(opened.exit, 0);
  assert.equal(opened.result.locked, false);
});

test("no code, or a code with a wrong check digit: exit 2 and an empty codes list", () => {
  for (const name of ["no-codes.pdf", "bad-check-digit.pdf"])
    assert.deepEqual(read(fixture(name)), {
      exit: 2,
      result: { type: "pdf", locked: false, codes: [] },
    });
});

test("a file that doesn't open: exit 1", () => {
  assert.equal(read(fixture("missing.pdf")).exit, 1);
});
