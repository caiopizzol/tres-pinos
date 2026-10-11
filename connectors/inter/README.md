# Inter

Servidor MCP que deixa um agente de IA ler a sua conta PJ no Banco Inter, pela API oficial: saldo e extrato. Ele
nunca movimenta dinheiro.

## Requisitos

- Uma conta Inter Empresas. A [API do Inter não atende contas PF nem MEI](https://ajuda.inter.co/conta-digital-pessoa-juridica/o-inter-disponibiliza-alguma-api-para-minha-conta-digital-pj).
- Uma integração criada no Internet Banking, em **Soluções para sua empresa > Nova Integração**, com o escopo
  **Consultar extrato e saldo** (`extrato.read`). Só esse: o conector não precisa de nenhum outro.

## Certificado

Ao criar a integração, o Inter entrega um certificado e uma chave. Copie os dois para a pasta `certificate/` da
raiz do repositório:

```bash
mkdir -p certificate
cp "Inter API_Certificado.crt" certificate/inter.crt
cp "Inter API_Chave.key" certificate/inter.key
```

A pasta fica fora do git. O conector roda como o usuário 1000 dentro do container. Se o seu usuário não for o
1000, passe os arquivos para ele, mantendo a chave legível só pelo dono:

```bash
chmod 600 certificate/inter.key
docker run --rm -v ./certificate:/c alpine chown 1000:1000 /c/inter.crt /c/inter.key
```

## Rodar

No `.env` da raiz do repositório, inclua `inter` em `COMPOSE_PROFILES` e preencha as variáveis abaixo. Depois:

```bash
docker compose up -d
```

Ligue o agente em `http://127.0.0.1:3013/mcp`, com o cabeçalho `Authorization: Bearer $INTER_KEY`.

## Configuração

| Variável              | O que faz                                                    |
| --------------------- | ------------------------------------------------------------ |
| `INTER_KEY`           | Chave que o agente envia. Pelo menos 32 caracteres           |
| `INTER_CLIENT_ID`     | O client ID da integração                                    |
| `INTER_CLIENT_SECRET` | O client secret da integração                                |
| `INTER_CERT_DIR`      | Pasta com `inter.crt` e `inter.key`. Padrão: `./certificate` |

## Ferramentas

| Ferramenta      | O que devolve                                                                         |
| --------------- | ------------------------------------------------------------------------------------- |
| `get_balance`   | Saldo e limite, em centavos. Um limite que o Inter não informa vem como `null`        |
| `get_statement` | As transações de um mês, em centavos. Um mês com mais de 10.000 transações é recusado |

O conector só deixa sair as chamadas dessas duas ferramentas. Qualquer outra, como um pagamento, é recusada
antes de chegar ao Inter, mesmo que a integração permita. O Inter aceita só uns cinco tokens por minuto; o
conector usa o mesmo token por quase uma hora, então isso não limita as ferramentas.

## Desenvolvimento

```bash
bun run test   # contra um Inter falso, com certificados gerados na hora
```
