// MCP server that gives an agent the tools in tools.mjs, behind INTER_KEY.
import { createPrivateKey, X509Certificate } from "node:crypto";
import { certificateFetch, readCertificate } from "@tres-pinos/bank";
import { serve } from "@tres-pinos/server";
import { readOnly } from "./guard.mjs";
import { interClient } from "./inter.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = [
  "INTER_KEY",
  "INTER_CLIENT_ID",
  "INTER_CLIENT_SECRET",
  "INTER_CERT_PATH",
  "INTER_CERT_KEY_PATH",
].filter((n) => !env[n]);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);

const cert = readCertificate(env.INTER_CERT_PATH);
const key = readCertificate(env.INTER_CERT_KEY_PATH);
// A swapped or mismatched file would otherwise show up later as a vague TLS error.
try {
  if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) throw new Error();
} catch {
  throw new Error("INTER_CERT_PATH and INTER_CERT_KEY_PATH are not a matching certificate and key");
}

const inter = interClient(
  { clientId: env.INTER_CLIENT_ID, clientSecret: env.INTER_CLIENT_SECRET },
  readOnly(certificateFetch({ cert, key })),
);
serve({
  name: "INTER_KEY",
  key: env.INTER_KEY,
  tools: () => buildServer(inter),
  port: Number(env.PORT ?? 8080),
});
