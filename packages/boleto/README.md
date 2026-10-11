# Boleto

Lê os códigos de boleto e Pix de um PDF ou da foto de uma conta, como CLI ou como biblioteca. Nunca usa a rede.

> [!IMPORTANT]
> Um código lido só da imagem do código de barras fica `unconfirmed`: o código de barras de 44 dígitos tem um
> único dígito verificador, então um erro de leitura ainda pode parecer válido. Confira antes de pagar.

## Requisitos

- [Bun](https://bun.sh) 1.3+ ou [Node.js](https://nodejs.org) 22.18+
- [Poppler](https://poppler.freedesktop.org) e [qpdf](https://qpdf.readthedocs.io), para PDFs

## Uso

```bash
bun run read conta.pdf                          # PDF, PNG ou JPEG
bun run read conta.pdf --reference 2026-09-26   # data de referência para o vencimento (padrão: hoje)
bun run read conta.pdf --password-file -        # senhas pela entrada padrão, uma por linha
```

Devolve JSON, resumido aqui:

```json
{
  "type": "pdf",
  "locked": false,
  "codes": [
    {
      "kind": "boleto",
      "line": "…",
      "amountCents": 18742,
      "dueDate": "2026-09-10",
      "status": "confirmed"
    },
    { "kind": "pix", "payload": "…", "amountCents": null, "status": "confirmed" }
  ]
}
```

| `status`      | Quando                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `confirmed`   | Linha digitável com todos os dígitos verificadores certos, duas leituras que concordam, ou um Pix (CRC16) |
| `unconfirmed` | Só a imagem do código de barras                                                                           |

- `kind`: `boleto`, `arrecadacao` (contas de consumo e tributos) ou `pix`.
- Um PDF que nenhuma senha abre devolve `"locked": true`. PDFs com mais de 20 páginas são recusados.
- Código de saída: `0` com um código confirmado, `2` sem nenhum, `1` com argumento inválido ou arquivo ilegível.

## Desenvolvimento

```bash
bun run test                   # contas sintéticas, em Bun e em Node
bun run corpus                 # as suas contas reais em corpus/, fora do git, contra corpus/expected.json
bun scripts/make-fixtures.ts   # gera de novo as contas sintéticas de fixtures/
```
