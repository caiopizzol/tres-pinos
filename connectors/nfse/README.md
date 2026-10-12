# NFS-e

Servidor MCP que deixa um agente de IA ler as notas fiscais de serviço da sua empresa no
[Sistema Nacional NFS-e](https://www.gov.br/nfse), pela distribuição oficial (ADN): as notas em que a empresa
aparece como emitente, tomadora ou intermediária, e os eventos delas, como cancelamentos. Ele nunca emite nem
cancela notas.

## Requisitos

- O certificado e-CNPJ A1 da empresa, o arquivo `.pfx` e a senha.

## Certificado

Converta o `.pfx` em um certificado e uma chave com senha, na pasta `certificate/` da raiz do repositório. O
OpenSSL pede a senha do `.pfx` e depois, duas vezes, uma senha nova para a chave:

```bash
mkdir -p certificate &&
  openssl pkcs12 -legacy -in certificado.pfx -clcerts -nokeys | openssl x509 -out certificate/nfse.crt &&
  openssl pkcs12 -legacy -in certificado.pfx -nocerts -noenc | openssl pkey -aes-256-cbc -out certificate/nfse.key
```

A pasta fica fora do git. A chave só abre com a senha, que vai em `NFSE_CERT_PASSWORD`. O conector roda como o
usuário 1000 dentro do container. Se o seu usuário não for o 1000, passe os arquivos para ele, mantendo a chave
legível só pelo dono:

```bash
docker run --rm -v ./certificate:/c alpine chown 1000:1000 /c/nfse.crt /c/nfse.key
```

## Rodar

No `.env` da raiz do repositório, inclua `nfse` em `COMPOSE_PROFILES` e preencha as variáveis abaixo. Depois:

```bash
docker compose up -d
```

Ligue o agente em `http://127.0.0.1:3014/mcp`, com o cabeçalho `Authorization: Bearer $NFSE_KEY`.

## Acesso pela internet

Com `NFSE_PUBLIC_URL`, o conector também aceita login, como o do [Inter](../inter#acesso-pela-internet). Publique
a porta 3014 nesse endereço com HTTPS. Os logins ficam no volume `nfse`.

## Configuração

| Variável             | O que faz                                                   |
| -------------------- | ----------------------------------------------------------- |
| `NFSE_KEY`           | Chave que o agente envia. Pelo menos 32 caracteres          |
| `NFSE_CERT_DIR`      | Pasta com `nfse.crt` e `nfse.key`. Padrão: `./certificate`  |
| `NFSE_CERT_PASSWORD` | A senha de `nfse.key`                                       |
| `NFSE_PUBLIC_URL`    | Endereço público com HTTPS, para entrar com login. Opcional |

## Ferramentas

| Ferramenta      | O que devolve                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `list_invoices` | Os próximos documentos, até 50, depois de um NSU. Comece no 0 e continue até `done` vir `true` |

O NSU é o número que o sistema nacional dá a cada documento, em ordem. Guarde o `lastNsu` de uma resposta para
pedir só os documentos novos na próxima vez.

Cada nota vem com os mesmos campos da CLI [`nfse`](../../packages/nfse#campos), mais o `nsu` e o `type` `NFSE`.
Qualquer outro documento vem só com `nsu`, `type`, `eventType` e a `accessKey` da nota a que se refere. Um
cancelamento, por exemplo, vem com `type` `EVENTO` e `eventType` `CANCELAMENTO`.

O conector só deixa sair essa consulta. Qualquer outra chamada, como emitir ou cancelar uma nota, é recusada antes
de chegar ao sistema nacional, mesmo que o certificado permita. Uma nota que não dá para ler direito faz a
consulta falhar, em vez de virar um palpite.

## Desenvolvimento

```bash
bun run test   # contra um sistema nacional falso, com certificados gerados na hora
```
