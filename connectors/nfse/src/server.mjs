// MCP server that gives an agent the tools in tools.mjs, behind NFSE_KEY.
import { createPrivateKey } from "node:crypto";
import { certificateFetch, readCertificate } from "@tres-pinos/api";
import { createApprovals, icons, serve } from "@tres-pinos/server";
import { adnClient } from "./adn.mjs";
import { guard } from "./guard.mjs";
import { sefinClient } from "./sefin.mjs";
import { buildServer } from "./tools.mjs";

// PORT is for tests; the image always listens on 8080.
const env = process.env;
const missing = ["NFSE_KEY", "NFSE_CERT_PATH", "NFSE_CERT_KEY_PATH", "NFSE_CERT_PASSWORD"].filter(
  (n) => !env[n],
);
if (missing.length) throw new Error(`Set ${missing.join(", ")}`);
// Issuing is off unless the owner turns it on, and then only in produção restrita.
const issue = env.NFSE_ISSUE ?? "";
if (!["", "restrita"].includes(issue)) throw new Error("NFSE_ISSUE can only be restrita");

// An invoice goes out only after the owner approves it with a key the agent doesn't have; the server keeps its hash.
// The owner opens the approval page at the public address, or at APPROVAL_URL, the port Compose publishes here.
const approvals =
  issue &&
  createApprovals({
    name: "NFSE_APPROVAL_HASH",
    hash: env.NFSE_APPROVAL_HASH,
    url: env.PUBLIC_URL || env.APPROVAL_URL,
  });

const certificate = readCertificate(env, "NFSE");
const fetch = guard(certificateFetch(certificate, 60_000), { issue: Boolean(issue) });
const adn = adnClient(fetch);
const sefin =
  issue &&
  sefinClient(fetch, {
    keyPem: createPrivateKey({ key: certificate.key, passphrase: certificate.passphrase }),
    certPem: certificate.cert.toString(),
  });
serve({
  name: "NFSE_KEY",
  key: env.NFSE_KEY,
  tools: () => buildServer(adn, icons(env.PUBLIC_URL), sefin || null, approvals || null),
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL,
  dataDir: env.DATA_DIR,
  approvals: approvals || undefined,
  consent: {
    title: "sistema nacional da NFS-e",
    reach: issue
      ? "Ele vai poder ler as notas fiscais de serviço da empresa e emitir notas no ambiente de teste (produção restrita), sem valor fiscal. Nunca cancela notas."
      : "Ele vai poder ler as notas fiscais de serviço da empresa. Nunca emite nem cancela notas.",
  },
});
