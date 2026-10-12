// Reads a Sicoob checking account through the official API: the balance and a month's statement. Sicoob
// authenticates the app with the owner's e-CPF certificate (mutual TLS), then issues a token per scope.
import { toCents } from "@tres-pinos/api";

export const TOKEN_URL =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
export const API_URL = "https://api.sicoob.com.br";
export const SCOPE = "cco_consulta";

// A request Sicoob answered with an error status. It never carries Sicoob's message text, which can
// include the account number: only the HTTP status and Sicoob's numeric code or OAuth error.
export class SicoobError extends Error {
  constructor(context, status, reason) {
    super(`Sicoob ${context} failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
    this.status = status;
    this.reason = reason;
  }
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
