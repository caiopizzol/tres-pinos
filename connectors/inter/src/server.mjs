// MCP server that gives an agent the tools in tools.mjs, behind INTER_KEY.
import { certificateFetch, readCertificate } from "@tres-pinos/api";
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

const inter = interClient(
  { clientId: env.INTER_CLIENT_ID, clientSecret: env.INTER_CLIENT_SECRET },
  readOnly(certificateFetch(readCertificate(env, "INTER"))),
);
serve({
  name: "INTER_KEY",
  key: env.INTER_KEY,
  tools: () => buildServer(inter),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  consent: {
    title: "seu Banco Inter",
    reach: "Ele vai poder ler o saldo e o extrato da conta. Nunca movimenta dinheiro.",
  },
});
