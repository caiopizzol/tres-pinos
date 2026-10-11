// Reads a Sicoob checking account through the official API: the balance and a month's statement. Sicoob
// authenticates the app with the owner's e-CPF certificate (mutual TLS), then issues a token per scope.
import https from "node:https";

export const TOKEN_URL =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
export const API_URL = "https://api.sicoob.com.br";
const SCOPE = "cco_consulta";

// A request Sicoob answered with an error status. It never carries Sicoob's message text, which can
// include the account number: only the HTTP status and Sicoob's numeric code or OAuth error.
export class SicoobError extends Error {
  constructor(context, status, reason) {
    super(`Sicoob ${context} failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
    this.status = status;
    this.reason = reason;
  }
}

// A fetch-like request over node:https with the certificate. Redirects are not followed: a redirect would
// carry the request, and the token request's credentials, to an address the guard never saw.
export function certificateFetch({ cert, key, passphrase, ca }, timeout = 10_000) {
  const agent = new https.Agent({ cert, key, passphrase, ca, keepAlive: true });
  return (url, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = https.request(url, { method, headers, agent, timeout }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("Sicoob did not answer in time")));
      req.on("error", reject);
      req.end(body);
    });
}

function json(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Sicoob ${context} returned invalid JSON`);
  }
}

function failure(context, { status, text }) {
  let reason = null;
  try {
    const body = JSON.parse(text);
    const code = (Array.isArray(body.mensagens) ? body.mensagens : [])
      .map((m) => m?.codigo)
      .find((c) => /^\d{1,6}$/.test(String(c)));
    if (code !== undefined) reason = `Sicoob code ${code}`;
    else if (typeof body.error === "string" && /^[a-z_]{1,64}$/.test(body.error))
      reason = body.error;
  } catch {}
  return new SicoobError(context, status, reason);
}

// Sicoob's decimal amount, such as "-12.3", as exact integer cents.
export function toCents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  const match = typeof text === "string" ? /^(-?)(\d{1,12})(?:\.(\d{1,2})0*)?$/.exec(text) : null;
  if (!match) throw new Error("Sicoob returned an invalid amount");
  const [, sign, units, fraction = ""] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return sign && cents !== 0 ? -cents : cents;
}

async function token({ clientId }, fetch) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      scope: SCOPE,
    }).toString(),
  });
  if (res.status !== 200) throw failure("token request", res);
  const body = json(res.text, "token request");
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new Error("Sicoob gave no access token");
  if (body.scope !== SCOPE) throw new Error("Sicoob granted a different scope than requested");
  return body.access_token;
}

async function account(config, fetch, path, context) {
  const query = new URLSearchParams({ numeroContaCorrente: config.account });
  const res = await fetch(`${API_URL}/conta-corrente/v4${path}?${query}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${await token(config, fetch)}`,
      client_id: config.clientId,
    },
  });
  if (res.status !== 200) throw failure(context, res);
  const { resultado } = json(res.text, context);
  if (typeof resultado !== "object" || resultado === null)
    throw new Error(`Unexpected Sicoob ${context} response`);
  return resultado;
}

export async function getBalance(config, fetch) {
  const r = await account(config, fetch, "/saldo", "balance request");
  return { balanceCents: toCents(r.saldo), limitCents: toCents(r.saldoLimite) };
}

export async function getStatement(config, fetch, year, month) {
  const r = await account(config, fetch, `/extrato/${month}/${year}`, "statement request");
  if (!Array.isArray(r.transacoes)) throw new Error("Sicoob's statement has no transactions list");
  return r.transacoes.map((t) => {
    if (![t?.transactionId, t?.data, t?.tipo, t?.descricao].every((v) => typeof v === "string")) {
      throw new Error("Sicoob returned an invalid statement transaction");
    }
    return {
      id: t.transactionId,
      date: t.data,
      type: t.tipo,
      amountCents: toCents(t.valor),
      description: t.descricao,
    };
  });
}
