// Reads boleto and Pix codes from a bill with packages/boleto. It runs as its own process, so decoding
// a large scan can't stall the connector, and the password goes through stdin, never an argument.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../../../packages/boleto/src/cli.ts", import.meta.url).pathname;

export async function readBill(bytes, password) {
  const dir = await mkdtemp(join(tmpdir(), "bill-"));
  try {
    const path = join(dir, "in");
    await writeFile(path, bytes);
    return await new Promise((resolve, reject) => {
      const options = { maxBuffer: 10e6, timeout: 120_000, killSignal: "SIGKILL" };
      const child = execFile(
        "node",
        [CLI, "read", path, "--password-file", "-"],
        options,
        (error, stdout, stderr) => {
          // Exit 2 is a result with no confirmed code, such as a locked or blank bill, not a failure.
          if (error && error.code !== 2)
            return reject(
              new Error(String(stderr).trim().split("\n").at(-1) || "Could not read the bill"),
            );
          resolve(JSON.parse(stdout));
        },
      );
      child.stdin.on("error", () => {});
      child.stdin.end(password ?? "");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
