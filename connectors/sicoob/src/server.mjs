// MCP server that gives an agent the tools in tools.mjs, behind SICOOB_KEY.
import { X509Certificate } from "node:crypto";
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { createApprovals, icons, serve } from "@tres-pinos/server";
import { guard } from "./guard.mjs";
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
// Paying is off unless the owner turns it on, and then only for boletos.
const pay = env.SICOOB_PAY ?? "";
if (!["", "boletos"].includes(pay)) throw new Error("SICOOB_PAY can only be boletos");

const certificate = readCertificate(env, "SICOOB");
let payer;
let approvals;
if (pay) {
  // Sicoob records who pays: the e-CPF's holder, whose certificate is named "NAME:CPF".
  const [, name, cpf] =
    /^CN=(.+):(\d{11})$/m.exec(new X509Certificate(certificate.cert).subject) ?? [];
  if (!name) throw new Error("Paying needs an e-CPF certificate in SICOOB_CERT_PATH");
  if (!/^\d{4}$/.test(env.SICOOB_COOPERATIVE ?? ""))
    throw new Error("Paying needs SICOOB_COOPERATIVE, the account's cooperative, 4 digits");
  payer = { name, cpf, cooperative: env.SICOOB_COOPERATIVE };
  // A boleto is paid only after the owner approves it with a key the agent doesn't have; the server keeps its hash.
  // The owner opens the approval page at the public address, or at APPROVAL_URL, the port Compose publishes here.
  approvals = createApprovals({
    name: "SICOOB_APPROVAL_HASH",
    hash: env.SICOOB_APPROVAL_HASH,
    url: env.PUBLIC_URL || env.APPROVAL_URL,
  });
}

const sicoob = sicoobClient(
  { clientId: env.SICOOB_CLIENT_ID, account: env.SICOOB_ACCOUNT, payer },
  guard(certificateFetch(certificate), { pay: Boolean(pay) }),
);
serve({
  name: "SICOOB_KEY",
  key: env.SICOOB_KEY,
  tools: () => buildServer(sicoob, icons(env.PUBLIC_URL), approvals),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  approvals,
  consent: {
    title: "seu Sicoob",
    reach: pay
      ? "Ele vai poder ler o saldo e o extrato da conta corrente, e pagar ou agendar boletos que você aprovar, um a um, na página do conector."
      : "Ele vai poder ler o saldo e o extrato da conta corrente. Nunca movimenta dinheiro.",
  },
});
