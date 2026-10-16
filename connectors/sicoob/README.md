# Sicoob

Servidor MCP que deixa um agente de IA ler a sua conta corrente no Sicoob, pela API oficial: saldo e extrato. Se você
ligar, ele também paga e agenda boletos, cada um só depois que você o aprova.

## Requisitos

- Um app no [portal de desenvolvedores do Sicoob](https://developers.sicoob.com.br), registrado com o seu
  certificado e-CPF A1, com as APIs e os escopos abaixo
- [OpenSSL](https://www.openssl.org) 3, para converter o certificado

| API                          | Escopos                                      | Para                               |
| ---------------------------- | -------------------------------------------- | ---------------------------------- |
| Conta Corrente               | `cco_consulta`                               | Saldo e extrato                    |
| Cobrança Bancária Pagamentos | `pagamentos_consulta`, `pagamentos_inclusao` | Pagar boletos. Só com `SICOOB_PAY` |

Não confunda com a API Cobrança Bancária, que emite boletos. Para pagar, a cooperativa também precisa liberar
pagamentos pela API na sua conta.

## Certificado

Converta o `.pfx` em um certificado e uma chave com senha, na pasta `certificate/` da raiz do repositório. O
OpenSSL pede a senha do `.pfx` e depois, duas vezes, uma senha nova para a chave:

```bash
mkdir -p certificate &&
  openssl pkcs12 -legacy -in certificado.pfx -clcerts -nokeys | openssl x509 -out certificate/sicoob.crt &&
  openssl pkcs12 -legacy -in certificado.pfx -nocerts -noenc | openssl pkey -aes-256-cbc -out certificate/sicoob.key
```

A pasta fica fora do git. A chave só abre com a senha, que vai em `SICOOB_CERT_PASSWORD`. O conector roda
como o usuário 1000 dentro do container. Se o seu usuário não for o 1000, passe os arquivos para ele, mantendo a
chave legível só pelo dono:

```bash
docker run --rm -v ./certificate:/c alpine chown 1000:1000 /c/sicoob.crt /c/sicoob.key
```

## Rodar

No `.env` da raiz do repositório, inclua `sicoob` em `COMPOSE_PROFILES` e preencha as variáveis abaixo. Depois:

```bash
docker compose up -d
```

## Ligar o agente

Na mesma máquina, ligue o agente em `http://127.0.0.1:3012/mcp`, com o cabeçalho
`Authorization: Bearer $SICOOB_KEY`.

Pela internet, publique a porta 3012 com HTTPS, por exemplo com um
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), ponha o
endereço em `SICOOB_PUBLIC_URL` e adicione `<endereço>/mcp` como conector MCP no seu app de IA. O app abre uma
página do conector, onde você digita a `SICOOB_KEY`. Um app na nuvem precisa ter o endereço de retorno do login na
lista de [`oauth.mjs`](../../packages/server/src/oauth.mjs).

Depois, pergunte: "Qual é o saldo da minha conta no Sicoob?"

## Configuração

| Variável               | O que faz                                                      |
| ---------------------- | -------------------------------------------------------------- |
| `SICOOB_KEY`           | Chave que o agente envia. Pelo menos 32 caracteres             |
| `SICOOB_CLIENT_ID`     | O client ID do app no portal do Sicoob                         |
| `SICOOB_ACCOUNT`       | Número da conta corrente, só dígitos                           |
| `SICOOB_CERT_DIR`      | Pasta com `sicoob.crt` e `sicoob.key`. Padrão: `./certificate` |
| `SICOOB_CERT_PASSWORD` | A senha de `sicoob.key`                                        |
| `SICOOB_PUBLIC_URL`    | Endereço público com HTTPS, para entrar com login. Opcional    |
| `SICOOB_PAY`           | `boletos` liga o pagamento de boletos. Veja [Pagar](#pagar)    |
| `SICOOB_COOPERATIVE`   | Com `SICOOB_PAY`, a cooperativa (agência) da conta, 4 dígitos  |
| `SICOOB_APPROVAL_HASH` | Com `SICOOB_PAY`, o SHA-256 da chave de aprovação              |

## Ferramentas

| Ferramenta       | O que devolve                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `get_balance`    | Saldo e limite, em centavos                                                                        |
| `get_statement`  | As transações de um mês, em centavos. O Sicoob guarda só os últimos três meses                     |
| `prepare_boleto` | Consulta um boleto, sem pagar, e devolve o link para você aprovar o pagamento. Só com `SICOOB_PAY` |
| `pay_boleto`     | Paga ou agenda uma vez o boleto que você aprovou. Só com `SICOOB_PAY`                              |

O conector só deixa sair as chamadas dessas ferramentas. Qualquer outra, como um Pix ou cancelar um agendamento, é
recusada antes de chegar ao Sicoob, mesmo que o certificado permita. Em rajadas, o Sicoob responde HTTP 429: faça as
chamadas de saldo e extrato com uns 20 segundos de intervalo. As de pagamento o conector espaça sozinho.

## Pagar

Com `SICOOB_PAY=boletos`, o conector paga e agenda boletos da sua conta. Cada boleto sai só depois que você o
aprova, numa página do conector, com uma chave de aprovação que o agente não recebe. O conector guarda só o SHA-256
dela e recusa chaves com menos de 32 caracteres. Gere a chave e o hash como na
[NFS-e](../nfse#emitir), e ponha o hash em `SICOOB_APPROVAL_HASH`.

1. `prepare_boleto` recebe a linha digitável ou o código de barras e, se quiser agendar, a data. Ele consulta o
   boleto no Sicoob e devolve um link. Nele você lê o beneficiário, o valor com desconto, multa e juros, o vencimento
   e o dia em que o Sicoob vai pagar, e aprova com a chave, ou recusa. Num fim de semana ou feriado, o Sicoob paga no
   dia útil seguinte, e a página já mostra esse dia.
2. `pay_boleto` paga uma vez o boleto que você aprovou, hoje ou no dia agendado. A aprovação serve para um pagamento
   só, em até 10 minutos.
3. Se a resposta não for clara, `prepare_boleto` com o mesmo boleto mostra o pagamento já feito, em vez de pagar de
   novo.

O comprovante mostra como pagador quem está no boleto, mas o dinheiro sai da sua conta. Acima do limite diário de
pagamentos pela API, o Sicoob recusa o pagamento, e o agente avisa; a cooperativa pode aumentar esse limite. Para
cancelar um agendamento, use o app do Sicoob.

O link é sempre `http://127.0.0.1:3012/approve/...`, ou o endereço de `SICOOB_PUBLIC_URL`: confira o endereço antes
de digitar a chave. Como na NFS-e, a aprovação protege contra um agente que só tem a chave do conector, não contra
quem controla a máquina do conector. Deixe na conta só o saldo que você quer que possa ser gasto.

## Desenvolvimento

```bash
bun run test   # contra um Sicoob falso, com certificados gerados na hora
```
