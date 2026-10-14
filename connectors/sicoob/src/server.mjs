// MCP server that gives an agent the tools in tools.mjs, behind SICOOB_KEY.
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { icons, serve } from "@tres-pinos/server";
import { readOnly } from "./guard.mjs";
import { sicoobClient } from "./sicoob.mjs";
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

const sicoob = sicoobClient(
  { clientId: env.SICOOB_CLIENT_ID, account: env.SICOOB_ACCOUNT },
  readOnly(certificateFetch(readCertificate(env, "SICOOB"))),
);
serve({
  name: "SICOOB_KEY",
  key: env.SICOOB_KEY,
  tools: () => buildServer(sicoob, icons(env.PUBLIC_URL)),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  consent: {
    title: "seu Sicoob",
    reach: "Ele vai poder ler o saldo e o extrato da conta corrente. Nunca movimenta dinheiro.",
  },
});
