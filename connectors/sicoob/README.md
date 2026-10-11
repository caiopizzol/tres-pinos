# Sicoob

Servidor MCP que deixa um agente de IA ler a sua conta corrente no Sicoob, pela API oficial: saldo e extrato.
Ele nunca movimenta dinheiro.

## Requisitos

- Um app no [portal de desenvolvedores do Sicoob](https://developers.sicoob.com.br), registrado com o seu
  certificado e-CPF A1 e com a API Conta Corrente
- [OpenSSL](https://www.openssl.org) 3, para converter o certificado

## Certificado

Converta o `.pfx` em um certificado e uma chave com senha, na pasta `certificate/` da raiz do repositório. O
OpenSSL pede a senha do `.pfx` e depois, duas vezes, uma senha nova para a chave:

```bash
mkdir certificate &&
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

Na raiz do repositório, preencha as variáveis abaixo no `.env`. Depois:

```bash
docker compose up -d
```

Ligue o agente em `http://127.0.0.1:3012/mcp`, com o cabeçalho `Authorization: Bearer $SICOOB_KEY`.

## Configuração

| Variável               | O que faz                                                      |
| ---------------------- | -------------------------------------------------------------- |
| `SICOOB_KEY`           | Chave que o agente envia. Pelo menos 32 caracteres             |
| `SICOOB_CLIENT_ID`     | O client ID do app no portal do Sicoob                         |
| `SICOOB_ACCOUNT`       | Número da conta corrente, só dígitos                           |
| `SICOOB_CERT_DIR`      | Pasta com `sicoob.crt` e `sicoob.key`. Padrão: `./certificate` |
| `SICOOB_CERT_PASSWORD` | A senha de `sicoob.key`                                        |

## Ferramentas

| Ferramenta      | O que devolve                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| `get_balance`   | Saldo e limite, em centavos                                                    |
| `get_statement` | As transações de um mês, em centavos. O Sicoob guarda só os últimos três meses |

O conector só deixa sair as chamadas dessas duas ferramentas. Qualquer outra, como um pagamento, é recusada
antes de chegar ao Sicoob, mesmo que o certificado permita. Faça as chamadas com uns 20 segundos de intervalo:
em rajadas, o Sicoob responde HTTP 429.

## Desenvolvimento

```bash
bun run test   # contra um Sicoob falso, com certificados gerados na hora
```
