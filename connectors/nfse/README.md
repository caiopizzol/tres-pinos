# NFS-e

Servidor MCP que deixa um agente de IA ler as notas fiscais de serviço da sua empresa no
[Sistema Nacional NFS-e](https://www.gov.br/nfse), pela distribuição oficial (ADN): as notas em que a empresa
aparece como emitente, tomadora ou intermediária, e os eventos delas, como cancelamentos. Se você ligar, também
emite notas no ambiente de teste (produção restrita), onde elas não têm valor fiscal. Ele nunca cancela notas.

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
chmod 600 certificate/nfse.key
docker run --rm -v ./certificate:/c alpine chown 1000:1000 /c/nfse.crt /c/nfse.key
```

## Rodar

No `.env` da raiz do repositório, inclua `nfse` em `COMPOSE_PROFILES` e preencha as variáveis abaixo. Depois:

```bash
docker compose up -d
```

Ligue o agente em `http://127.0.0.1:3014/mcp`, com o cabeçalho `Authorization: Bearer $NFSE_KEY`.

## Acesso pela internet

Com `NFSE_PUBLIC_URL`, o conector também aceita login, como o do [Inter](../inter#ligar-o-agente). Publique
a porta 3014 nesse endereço com HTTPS e adicione `https://nfse.seudominio.com/mcp` como conector MCP no seu app de
IA, com o mesmo cuidado com apps na nuvem. Os logins ficam no volume `nfse`.

## Configuração

| Variável             | O que faz                                                           |
| -------------------- | ------------------------------------------------------------------- |
| `NFSE_KEY`           | Chave que o agente envia. Pelo menos 32 caracteres                  |
| `NFSE_CERT_DIR`      | Pasta com `nfse.crt` e `nfse.key`. Padrão: `./certificate`          |
| `NFSE_CERT_PASSWORD` | A senha de `nfse.key`                                               |
| `NFSE_PUBLIC_URL`    | Endereço público com HTTPS, para entrar com login. Opcional         |
| `NFSE_ISSUE`         | `restrita` liga a [emissão](#emitir) no ambiente de teste. Opcional |
| `NFSE_APPROVAL_HASH` | O SHA-256 da sua chave de aprovação. Obrigatório com `NFSE_ISSUE`   |

## Ferramentas

| Ferramenta        | O que devolve                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_invoices`   | Os próximos documentos, até 50, depois de um NSU. Comece no 0 e continue até `done` vir `true`              |
| `prepare_invoice` | Confere a DPS no esquema oficial, sem enviar, e devolve o link para você aprová-la. Só com `NFSE_ISSUE`     |
| `issue_invoice`   | Envia uma vez a DPS que você aprovou e devolve a nota emitida. Só com `NFSE_ISSUE`                          |
| `find_invoice`    | Diz se o sistema nacional gerou uma nota para um Id de DPS e, se gerou, devolve a nota. Só com `NFSE_ISSUE` |

O NSU é o número que o sistema nacional dá a cada documento, em ordem. Guarde o `lastNsu` de uma resposta para
pedir só os documentos novos na próxima vez.

Cada nota vem com os mesmos campos da CLI [`nfse`](../../packages/nfse#campos), mais o `nsu` e o `type` `NFSE`.
Qualquer outro documento vem só com `nsu`, `type`, `eventType` e a `accessKey` da nota a que se refere. Um
cancelamento, por exemplo, vem com `type` `EVENTO` e `eventType` `CANCELAMENTO`.

O conector só deixa sair essa consulta e, com `NFSE_ISSUE`, as chamadas de emissão e de consulta no ambiente de teste.
Qualquer outra, como emitir uma nota de verdade ou cancelar uma, é recusada antes de chegar ao sistema nacional,
mesmo que o certificado permita. Uma nota que não dá para ler direito faz a consulta falhar, em vez de virar um
palpite.

## Emitir

Com `NFSE_ISSUE=restrita`, o conector emite notas na produção restrita, o ambiente de teste do sistema nacional. Lá
uma nota não tem valor fiscal. Cada nota sai só depois que você a aprova, numa página do conector, com uma chave de
aprovação que o agente não recebe. O conector guarda só o SHA-256 dela e recusa chaves com menos de 32 caracteres.
Com uma chave aleatória como a do `openssl` abaixo, nem um agente que leia o `.env` consegue descobri-la; não use uma
senha que você inventou.

Gere a chave e guarde-a no seu gerenciador de senhas, fora da máquina do agente. Depois calcule o hash: o `read -s`
pede a chave sem mostrá-la e sem gravá-la no histórico do terminal. Ponha o hash em `NFSE_APPROVAL_HASH`:

```bash
openssl rand -hex 32   # a chave de aprovação, só para você
read -rs KEY && printf %s "$KEY" | shasum -a 256 | cut -c1-64; unset KEY
```

O agente monta a DPS, a declaração da qual a nota é gerada, com `tpAmb` 2, e:

1. `prepare_invoice` confere a DPS no esquema oficial, sem enviar, e devolve um link. Nele você lê a DPS (o tomador,
   o valor, a competência, a descrição e depois cada campo, tirados da própria DPS) e aprova com a chave, ou recusa.
   O pedido vale uma hora, e cinco chaves erradas o apagam. Depois de aprovar, a mesma página deixa cancelar.
2. `issue_invoice` envia uma vez a DPS que você aprovou e devolve a nota emitida, lida como em `list_invoices`. A
   aprovação serve para um envio só, em até 10 minutos, e o conector esquece as que não foram usadas quando reinicia.
3. Se a resposta não for clara, como um tempo esgotado, `find_invoice` diz se a nota foi gerada. Nunca envie a mesma
   DPS com outro número: isso emitiria uma segunda nota.

O link é sempre `http://127.0.0.1:3014/approve/...`, ou o endereço de `NFSE_PUBLIC_URL`: confira o endereço antes de
digitar a chave. A aprovação protege contra um agente que só tem a chave do conector. Quem controla a máquina do
conector, com acesso ao Docker ou ao certificado, passa por cima dela: rode o conector onde o agente não tenha esse
acesso.

Use uma série de DPS só para o conector, para não repetir o número de uma nota emitida pelo portal ou pelo seu
contador. A emissão usa o [open-nfse](https://github.com/fm-s/open-nfse) para conferir e assinar a DPS.

## Desenvolvimento

```bash
bun run test   # contra um sistema nacional falso, com certificados gerados na hora
```
