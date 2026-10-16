// Reads a Sicoob checking account through the official API, the balance and a month's statement, and pays boletos
// when the owner turns paying on. Sicoob authenticates the app with the owner's e-CPF certificate (mutual TLS), then
// issues a token per scope.
import { createHash } from "node:crypto";
import { toCents } from "@tres-pinos/api";

export const TOKEN_URL =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
export const API_URL = "https://api.sicoob.com.br";
export const SCOPE = "cco_consulta";
// Looking a boleto or a payment up, and paying.
export const LOOKUP_SCOPE = "pagamentos_consulta";
export const PAY_SCOPE = "pagamentos_inclusao";
const BOLETOS = `${API_URL}/pagamentos/v3/boletos`;

// A request Sicoob answered with an error status. It never carries Sicoob's message text, which can
// include the account number: only the HTTP status and Sicoob's numeric code or OAuth error.
export class SicoobError extends Error {
  constructor(context, status, reason) {
    super(`Sicoob ${context} failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
    this.status = status;
    this.reason = reason;
  }
}

// A real day as YYYY-MM-DD: Sicoob rolls an impossible one, such as February 30, into the next month.
export const isDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().startsWith(value);

// Today in Brazil, as YYYY-MM-DD.
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

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

// A boleto payment's state. Any state Sicoob hasn't been seen to send becomes "unknown", since it could carry data.
const STATES = ["Efetivado", "Agendado", "Rejeitado", "Cancelado"];
function payment(r, context) {
  if (!Number.isSafeInteger(r.idPagamento) || !isDate(r.dataPagamento))
    throw new Error(`Sicoob returned an invalid ${context}`);
  return {
    id: r.idPagamento,
    state: STATES.includes(r.situacaoPagamento) ? r.situacaoPagamento : "unknown",
    paymentDate: r.dataPagamento,
  };
}

// Reads the account and, with `payer`, pays boletos. Sicoob issues a token per request, so none is kept. `payer` is
// who Sicoob records as paying: the e-CPF's holder, by name and CPF, and the cooperative that holds the account.
export function sicoobClient({ clientId, account, payer }, fetch) {
  // The account as the payment path names it, everywhere: leading zeros name the same account, and a key written
  // with them wouldn't find the payment made without them after a restart. The server takes only digits.
  const paymentAccount = String(Number(account));

  async function token(scope) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        scope,
      }).toString(),
    });
    if (res.status !== 200) throw failure("token request", res);
    const body = json(res.text, "token request");
    if (typeof body.access_token !== "string" || !body.access_token)
      throw new Error("Sicoob gave no access token");
    if (body.scope !== scope) throw new Error("Sicoob granted a different scope than requested");
    return body.access_token;
  }

  // Sicoob's `resultado` for one request with a token for `scope`; `init` adds a method, headers and a body. With
  // `allowEmpty`, a success with no body gives null instead of failing: only a caller that has a meaning for
  // "nothing here", such as looking for a payment, asks for it.
  async function result(scope, url, context, { allowEmpty = false, ...init } = {}) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${await token(scope)}`,
        client_id: clientId,
        ...init.headers,
      },
    });
    if (res.status < 200 || res.status >= 300) throw failure(context, res);
    if (allowEmpty && !res.text) return null;
    const { resultado } = json(res.text, context);
    if (typeof resultado !== "object" || resultado === null)
      throw new Error(`Unexpected Sicoob ${context} response`);
    return resultado;
  }

  const get = (path, context) =>
    result(
      SCOPE,
      `${API_URL}/conta-corrente/v4${path}?${new URLSearchParams({ numeroContaCorrente: account })}`,
      context,
    );

  // The x-idempotency-key for paying `barcode`, as Sicoob wants it: cooperative-account-UUID. The UUID comes from the
  // barcode, so the same boleto always gets the same key, and `attempt` moves past a cancelled or rejected payment.
  function paymentKey(barcode, attempt) {
    const hex = createHash("sha256").update(`${barcode}:${attempt}`).digest("hex");
    const variant = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return `${payer.cooperative}-${paymentAccount}-${uuid}`;
  }

  // The key to pay `barcode` with, or the payment already made with it, paid or scheduled: so a payment whose
  // answer was lost is found instead of made again.
  async function findKey(barcode) {
    const query = new URLSearchParams({ numeroConta: paymentAccount });
    for (let attempt = 0; attempt < 10; attempt++) {
      const key = paymentKey(barcode, attempt);
      let earlier;
      try {
        const found = await result(
          LOOKUP_SCOPE,
          `${BOLETOS}/pagamentos/${key}/idempotency/comprovantes?${query}`,
          "boleto receipt",
          { allowEmpty: true },
        );
        // Sicoob answered that the request worked and there is no payment to return.
        if (found === null) return { key };
        earlier = payment(found, "boleto receipt");
      } catch (error) {
        // Sicoob has no payment with this key.
        if (error instanceof SicoobError && error.reason === "Sicoob code 10275") return { key };
        throw error;
      }
      if (!["Cancelado", "Rejeitado"].includes(earlier.state)) return { earlier };
    }
    throw new Error("This boleto has too many cancelled or rejected payments");
  }

  // The boletos being paid right now. The key is chosen against what Sicoob has, so two payments for one boleto
  // must not look at once and both believe the key is free.
  const paying = new Set();

  return {
    fetch,

    async getBalance() {
      const r = await get("/saldo", "balance request");
      return { balanceCents: toCents(r.saldo), limitCents: toCents(r.saldoLimite) };
    },

    async getStatement(year, month) {
      const r = await get(`/extrato/${month}/${year}`, "statement request");
      if (!Array.isArray(r.transacoes))
        throw new Error("Sicoob's statement has no transactions list");
      return r.transacoes.map((t) => {
        if (
          ![t?.transactionId, t?.data, t?.tipo, t?.descricao].every((v) => typeof v === "string")
        ) {
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
    },

    // The boleto with the 44-digit `barcode`, as Sicoob would pay it on `date`: the payee, the amount with any
    // discount, fine and interest, and the day Sicoob pays on, the next business day when `date` isn't one.
    async getBoleto(barcode, date) {
      const query = new URLSearchParams({ numeroConta: paymentAccount, dataPagamento: date });
      const r = await result(LOOKUP_SCOPE, `${BOLETOS}/${barcode}?${query}`, "boleto lookup");
      if (r.codigoBarras !== barcode) throw new Error("Sicoob returned a different boleto");
      if (r.bloquearPagamento !== false)
        throw new SicoobError("boleto lookup", 200, "payment blocked");
      if (
        typeof r.nomeRazaoSocialBeneficiario !== "string" ||
        !r.nomeRazaoSocialBeneficiario.trim() ||
        typeof r.identificadorConsulta !== "string" ||
        ![r.dataVencimentoBoleto, r.dataPagamento].every(isDate)
      )
        throw new Error("Sicoob returned an invalid boleto");
      return {
        barcode,
        payee: r.nomeRazaoSocialBeneficiario,
        amountCents: toCents(r.valorPagamento),
        faceCents: toCents(r.valorBoleto),
        discountCents: toCents(r.valorAbatimentoDesconto),
        feesCents: toCents(r.valorMultaMora),
        dueDate: r.dataVencimentoBoleto,
        paymentDate: r.dataPagamento,
        consultationId: r.identificadorConsulta,
      };
    },

    // The payment already made for `barcode`, paid or scheduled, as { earlier }: so a payment whose answer was
    // lost is found instead of made again. Without one, { key }, the key a payment would use.
    paymentKey: findKey,

    // Pays `boleto`, as getBoleto returned it, today or on its paymentDate. This moves money. The key is chosen
    // here, against what Sicoob has now, so the answer to this payment is never another approval's: a boleto that
    // already has a live payment comes back as { earlierPayment } and nothing is sent. A payment Sicoob doesn't
    // take, even with HTTP 200, fails with its state.
    async payBoleto(boleto) {
      if (paying.has(boleto.barcode)) throw new Error("This boleto is already being paid");
      paying.add(boleto.barcode);
      try {
        const found = await findKey(boleto.barcode);
        if (found.earlier) return { earlierPayment: found.earlier };
        const paid = payment(
          await result(PAY_SCOPE, `${BOLETOS}/pagamentos/${boleto.barcode}`, "boleto payment", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-idempotency-key": found.key },
            body: JSON.stringify({
              identificadorConsulta: boleto.consultationId,
              valorBoleto: boleto.faceCents / 100,
              valorDescontoAbatimento: boleto.discountCents / 100,
              valorMultaMora: boleto.feesCents / 100,
              aceitaValorDivergente: false,
              numeroCpfCnpjPortador: payer.cpf,
              nomePortador: payer.name,
              amount: boleto.amountCents / 100,
              date: boleto.paymentDate,
              debtorAccount: {
                issuer: Number(payer.cooperative),
                number: Number(paymentAccount),
                accountType: 0,
                personType: 0,
              },
            }),
          }),
          "boleto payment",
        );
        if (!["Efetivado", "Agendado"].includes(paid.state))
          throw new SicoobError("boleto payment", 200, paid.state);
        return paid;
      } finally {
        paying.delete(boleto.barcode);
      }
    },
  };
}
