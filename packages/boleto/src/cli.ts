// boleto-reader read <file> [--reference YYYY-MM-DD] [--password-file <file>]
// Prints every payment code found as JSON. Exit 0 when a code is confirmed, 2 when none is,
// 1 for bad arguments or an unreadable file. Passwords come from a file, one per line, or
// from stdin with `-`, never from arguments, which other users can see in the process list.
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { read } from "./read.ts";

const usage = "Usage: boleto-reader read <file> [--reference YYYY-MM-DD] [--password-file <file>]";

function args() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        reference: { type: "string" },
        "password-file": { type: "string" },
      },
    });
  } catch {
    throw new Error(usage);
  }
}

try {
  const { values, positionals } = args();
  const [command, path, ...extra] = positionals;
  const { reference, "password-file": passwordFile } = values;
  if (
    command !== "read" ||
    !path ||
    extra.length > 0 ||
    (reference !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(reference))
  )
    throw new Error(usage);
  const passwords =
    passwordFile === undefined
      ? []
      : (passwordFile === "-" ? await text(process.stdin) : await readFile(passwordFile, "utf8"))
          .split(/\r?\n/)
          .filter(Boolean);
  const result = await read(path, reference ? new Date(reference) : new Date(), passwords);
  console.log(JSON.stringify(result, null, 2));
  // Set the code instead of exiting: Node writes to a pipe asynchronously, and exiting would cut
  // the JSON short.
  process.exitCode = result.codes.some((code) => code.status === "confirmed") ? 0 : 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
