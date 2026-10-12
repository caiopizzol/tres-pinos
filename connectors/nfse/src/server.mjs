// MCP server that gives an agent the tool in tools.mjs, behind NFSE_KEY.
import { createPrivateKey, X509Certificate } from "node:crypto";
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { serve } from "@tres-pinos/server";
import { adnClient } from "./adn.mjs";
import { readOnly } from "./guard.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = ["NFSE_KEY", "NFSE_CERT_PATH", "NFSE_CERT_KEY_PATH", "NFSE_CERT_PASSWORD"].filter(
  (n) => !env[n],
);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);

const cert = readCertificate(env.NFSE_CERT_PATH);
const key = readCertificate(env.NFSE_CERT_KEY_PATH);
// A wrong password or a mismatched file would otherwise show up later as a vague TLS error.
let privateKey;
try {
  privateKey = createPrivateKey({ key, passphrase: env.NFSE_CERT_PASSWORD });
} catch {
  throw new Error("NFSE_CERT_PASSWORD does not open NFSE_CERT_KEY_PATH");
}
try {
  if (!new X509Certificate(cert).checkPrivateKey(privateKey)) throw new Error();
} catch {
  throw new Error("NFSE_CERT_PATH and NFSE_CERT_KEY_PATH are not a matching certificate and key");
}

const adn = adnClient(
  readOnly(certificateFetch({ cert, key, passphrase: env.NFSE_CERT_PASSWORD }, 60_000)),
);
serve({
  name: "NFSE_KEY",
  key: env.NFSE_KEY,
  tools: () => buildServer(adn),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  consent: {
    title: "sistema nacional da NFS-e",
    reach:
      "Ele vai poder ler as notas fiscais de serviço da empresa. Nunca emite nem cancela notas.",
  },
});
