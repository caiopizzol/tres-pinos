#!/usr/bin/env node
// nfse read <file.xml>
// Prints the NFS-e's facts as JSON. Exit 0 when read, 1 for bad arguments or a file that isn't a readable NFS-e.
import { readFile, stat } from "node:fs/promises";
import { MAX_BYTES, NfseError, readNfse } from "./nfse.mjs";

const [command, path, ...extra] = process.argv.slice(2);
try {
  if (command !== "read" || !path || extra.length)
    throw new NfseError("Usage: nfse read <file.xml>");
  const size = await stat(path).then(
    (s) => s.size,
    () => {
      throw new NfseError(`Can't read ${path}`);
    },
  );
  // Checked before reading, so a huge file is refused without loading it.
  if (size > MAX_BYTES) throw new NfseError("The XML is larger than 1 MB");
  const xml = await readFile(path, "utf8");
  console.log(JSON.stringify(readNfse(xml), null, 2));
} catch (error) {
  console.error(error instanceof NfseError ? error.message : String(error));
  process.exitCode = 1;
}
