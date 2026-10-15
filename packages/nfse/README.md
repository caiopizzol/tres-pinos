# NFS-e

Lê uma NFS-e do padrão nacional (Sistema Nacional NFS-e, versões 1.00 e 1.01) e devolve os fatos em JSON, como CLI
ou como biblioteca. Nunca usa a rede. O [conector da NFS-e](../../connectors/nfse) o usa para ler cada nota.

> [!IMPORTANT]
> Não confere a assinatura digital. Um campo que falta, se repete ou vem em formato errado faz a leitura falhar, em
> vez de virar um palpite.

## Requisitos

- [Node.js](https://nodejs.org) 22+

## Uso

```bash
node src/cli.mjs read nota.xml
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

| Campo                            | O que é                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `accessKey`                      | A chave de acesso, 50 caracteres: dígitos, e letras só no CNPJ do emitente                      |
| `generationCode`                 | Como a nota foi gerada: 100 normal, 101 substituição, 102 decisão judicial, 103 avulsa, 107 MEI |
| `generatedAt`                    | Quando o sistema nacional gerou a nota                                                          |
| `dpsIssuedAt`                    | Quando o prestador emitiu a declaração (DPS)                                                    |
| `dpsId`                          | O Id da DPS: município, CNPJ ou CPF, série e número                                             |
| `competence`                     | A data de competência                                                                           |
| `issuer`, `provider`             | Quem emitiu a nota e quem prestou o serviço. Podem ser diferentes                               |
| `provider.municipalRegistration` | A inscrição municipal do prestador, ou `null` se a DPS não informa                              |
| `provider.simplesNacional`       | A situação do prestador no Simples Nacional: `1` não optante, `2` MEI, `3` ME/EPP               |
| `recipient`                      | O tomador, ou `null`. Sem CNPJ, CPF ou NIF, `idType` é `none` e `noIdReason` diz o motivo       |
| `serviceAmountCents`             | O valor do serviço, em centavos                                                                 |
| `unconditionalDiscountCents`     | O desconto incondicionado, em centavos, ou 0                                                    |
| `netAmountCents`                 | O valor líquido, depois de descontos e retenções, em centavos                                   |
| `federalTaxPercent`              | O percentual aproximado dos tributos federais declarado na nota, como `"7.68"`, ou `null`       |

Uma nota cancelada continua com o mesmo `generationCode`: o cancelamento é um evento à parte. Nenhum campo diz
se a nota foi paga.

## Desenvolvimento

```bash
bun run test
```

`fixtures/nfse.xml` é uma nota fictícia que segue o esquema oficial 1.01.
