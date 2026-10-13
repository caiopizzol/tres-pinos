// MCP server that gives an agent the tool in tools.mjs, behind NFSE_KEY.
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { icons, serve } from "@tres-pinos/server";
import { adnClient } from "./adn.mjs";
import { readOnly } from "./guard.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = ["NFSE_KEY", "NFSE_CERT_PATH", "NFSE_CERT_KEY_PATH", "NFSE_CERT_PASSWORD"].filter(
  (n) => !env[n],
);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);

const adn = adnClient(readOnly(certificateFetch(readCertificate(env, "NFSE"), 60_000)));
serve({
  name: "NFSE_KEY",
  key: env.NFSE_KEY,
  tools: () => buildServer(adn, icons(env.PUBLIC_URL)),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  consent: {
    title: "sistema nacional da NFS-e",
    reach:
      "Ele vai poder ler as notas fiscais de serviço da empresa. Nunca emite nem cancela notas.",
  },
});
