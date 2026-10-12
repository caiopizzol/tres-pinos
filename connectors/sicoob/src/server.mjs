// MCP server that gives an agent the tools in tools.mjs, behind SICOOB_KEY.
import { createPrivateKey } from "node:crypto";
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { serve } from "@tres-pinos/server";
import { readOnly } from "./guard.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = [
  "SICOOB_KEY",
  "SICOOB_CLIENT_ID",
  "SICOOB_ACCOUNT",
  "SICOOB_CERT_PATH",
  "SICOOB_CERT_KEY_PATH",
  "SICOOB_CERT_PASSWORD",
].filter((n) => !env[n]);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);
if (!/^\d{1,14}$/.test(env.SICOOB_ACCOUNT))
  throw new Error("SICOOB_ACCOUNT is the account number, digits only");

const cert = readCertificate(env.SICOOB_CERT_PATH);
const key = readCertificate(env.SICOOB_CERT_KEY_PATH);
// A wrong password would otherwise show up later as a vague TLS error.
try {
  createPrivateKey({ key, passphrase: env.SICOOB_CERT_PASSWORD });
} catch {
  throw new Error("SICOOB_CERT_PASSWORD does not open SICOOB_CERT_KEY_PATH");
}

const config = { clientId: env.SICOOB_CLIENT_ID, account: env.SICOOB_ACCOUNT };
const fetch = readOnly(certificateFetch({ cert, key, passphrase: env.SICOOB_CERT_PASSWORD }));
serve({
  name: "SICOOB_KEY",
  key: env.SICOOB_KEY,
  tools: () => buildServer(config, fetch),
  port: Number(env.PORT ?? 8080),
});
