# NFS-e

[![npm](https://img.shields.io/npm/v/@tres-pinos/nfse?color=1d1d1f)](https://www.npmjs.com/package/@tres-pinos/nfse)

Lê uma NFS-e do padrão nacional (Sistema Nacional NFS-e, versões 1.00 e 1.01) e devolve os fatos em JSON, como CLI
ou como biblioteca. Nunca usa a rede.

> [!IMPORTANT]
> Não confere a assinatura digital. Um campo que falta, se repete ou vem em formato errado faz a leitura falhar, em
> vez de virar um palpite.

## Requisitos

- [Node.js](https://nodejs.org) 22+

## Uso

```bash
npx @tres-pinos/nfse read nota.xml
```

Ou, como biblioteca:

```js
import { readNfse } from "@tres-pinos/nfse";

const nfse = readNfse(xml);
```

Devolve JSON, resumido aqui:

```json
{
  "accessKey": "41069022200000000000191000000000000126090000000001",
  "number": "1",
  "generationCode": "100",
  "competence": "2026-08-31",
  "issuer": { "idType": "CNPJ", "id": "00000000000191", "name": "EMPRESA FICTICIA LTDA" },
  "recipient": { "idType": "CPF", "id": "00000000191", "name": "FULANO & FILHOS" },
  "serviceAmountCents": 150050,
  "netAmountCents": 145050
}
```

## Campos

| Campo                | O que é                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `accessKey`          | A chave de acesso, 50 dígitos                                                                   |
| `generationCode`     | Como a nota foi gerada: 100 normal, 101 substituição, 102 decisão judicial, 103 avulsa, 107 MEI |
| `generatedAt`        | Quando o sistema nacional gerou a nota                                                          |
| `dpsIssuedAt`        | Quando o prestador emitiu a declaração (DPS)                                                    |
| `competence`         | A data de competência                                                                           |
| `issuer`, `provider` | Quem emitiu a nota e quem prestou o serviço. Podem ser diferentes                               |
| `recipient`          | O tomador, ou `null`. Sem CNPJ, CPF ou NIF, `idType` é `none` e `noIdReason` diz o motivo       |
| `serviceAmountCents` | O valor do serviço, em centavos                                                                 |
| `netAmountCents`     | O valor líquido, depois de descontos e retenções, em centavos                                   |

Uma nota cancelada continua com o mesmo `generationCode`: o cancelamento é um evento à parte. Nenhum campo diz
se a nota foi paga.

## Desenvolvimento

```bash
bun run test
```

`fixtures/nfse.xml` é uma nota fictícia que segue o esquema oficial 1.01.
