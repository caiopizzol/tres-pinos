#!/usr/bin/env node
// nfse read <file.xml>
// Prints the NFS-e's facts as JSON. Exit 0 when read, 1 for bad arguments or a file that isn't a readable NFS-e.
import { readFile } from "node:fs/promises";
import { NfseError, readNfse } from "./nfse.mjs";

const [command, path, ...extra] = process.argv.slice(2);
try {
  if (command !== "read" || !path || extra.length)
    throw new NfseError("Usage: nfse read <file.xml>");
  const xml = await readFile(path, "utf8").catch(() => {
    throw new NfseError(`Can't read ${path}`);
  });
  console.log(JSON.stringify(readNfse(xml), null, 2));
} catch (error) {
  console.error(error instanceof NfseError ? error.message : String(error));
  process.exitCode = 1;
}
