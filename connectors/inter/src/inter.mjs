// Reads a Banco Inter business account through the official Banking API: the balance and a month's statement.
// Inter authenticates the integration with its certificate (mutual TLS) and client secret, then issues a token
// per scope. It allows only about five tokens a minute, so a token is kept until shortly before it expires.
import { toCents } from "@tres-pinos/bank";

export const API_URL = "https://cdpj.partners.bancointer.com.br";
export const TOKEN_URL = `${API_URL}/oauth/v2/token`;
export const SCOPE = "extrato.read";
// The most transactions one statement request returns; a month with more is refused instead of cut short.
export const PAGE_SIZE = 10000;

// A request Inter answered with an error status. It carries only the status: Inter's message text can quote
// the request.
export class InterError extends Error {
  constructor(context, status) {
    super(`Inter ${context} failed (HTTP ${status})`);
    this.status = status;
  }
}

function json(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Inter ${context} returned invalid JSON`);
  }
}

// Reads the account. `now` is for tests.
export function interClient({ clientId, clientSecret }, fetch, now = Date.now) {
  // The current token, as a promise that callers share, so concurrent calls make one token request.
  let token = null;
  let expiresAt = 0;

  function accessToken() {
    if (!token || now() >= expiresAt) {
      expiresAt = Number.POSITIVE_INFINITY;
      const pending = requestToken().then(
        (fresh) => {
          expiresAt = fresh.expiresAt;
          return fresh.value;
        },
        (error) => {
          if (token === pending) token = null;
          throw error;
        },
      );
      token = pending;
    }
    return token;
  }

  async function requestToken() {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: SCOPE,
      }).toString(),
    });
    if (res.status !== 200) throw new InterError("token request", res.status);
    const body = json(res.text, "token request");
    if (typeof body.access_token !== "string" || !body.access_token)
      throw new Error("Inter gave no access token");
    if (body.scope !== SCOPE) throw new Error("Inter granted a different scope than requested");
    if (!(Number.isInteger(body.expires_in) && body.expires_in > 120))
      throw new Error("Inter gave no token lifetime");
    // A minute early, so a token never expires between this check and Inter's.
    return { value: body.access_token, expiresAt: now() + (body.expires_in - 60) * 1000 };
  }

  async function get(url, context) {
    const used = accessToken();
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${await used}` },
    });
    // Inter no longer accepts the token; the next call asks for a new one.
    if (res.status === 401 && token === used) token = null;
    if (res.status !== 200) throw new InterError(context, res.status);
    const body = json(res.text, context);
    if (typeof body !== "object" || body === null)
      throw new Error(`Unexpected Inter ${context} response`);
    return body;
  }

  return {
    fetch,

    async getBalance() {
      const r = await get(`${API_URL}/banking/v2/saldo`, "balance request");
      // Inter can leave the limit out; that is no limit reported, not a limit of 0.
      return {
        balanceCents: toCents(r.disponivel),
        limitCents: r.limite === undefined || r.limite === null ? null : toCents(r.limite),
      };
    },

    async getStatement(year, month) {
      const pad = (n) => String(n).padStart(2, "0");
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const query = new URLSearchParams({
        dataInicio: `${year}-${pad(month)}-01`,
        dataFim: `${year}-${pad(month)}-${pad(last)}`,
        tamanhoPagina: String(PAGE_SIZE),
      });
      const r = await get(`${API_URL}/banking/v2/extrato/completo?${query}`, "statement request");
      if (!Array.isArray(r.transacoes))
        throw new Error("Inter's statement has no transactions list");
      // Inter sends 0 pages for an empty month and 1 for a full one; anything else may be cut short.
      if (r.totalPaginas > 1)
        throw new Error(`Inter's statement has more than ${PAGE_SIZE} transactions this month`);
      if (r.totalPaginas !== (r.transacoes.length ? 1 : 0))
        throw new Error("Inter's statement has no page count");
      return r.transacoes.map((t) => {
        const type = { C: "CREDITO", D: "DEBITO" }[t?.tipoOperacao];
        if (
          !type ||
          ![t.idTransacao, t.dataTransacao, t.titulo, t.descricao].every(
            (v) => typeof v === "string",
          ) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(t.dataTransacao)
        ) {
          throw new Error("Inter returned an invalid statement transaction");
        }
        return {
          id: t.idTransacao,
          date: t.dataTransacao,
          type,
          amountCents: toCents(t.valor),
          title: t.titulo,
          description: t.descricao,
        };
      });
    },
  };
}
