<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="Três Pinos">
</p>

<h1 align="center">Três pinos, nenhum adaptador.</h1>

<p align="center">
  A tomada brasileira para agentes de IA: conectores MCP de código aberto,
  <br>
  que você hospeda, para ler boletos, Pix e a sua conta no Sicoob.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licença-MIT-1d1d1f" alt="Licença MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-1.3+-1d1d1f" alt="Bun"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-servidor-f7c831?labelColor=1d1d1f" alt="MCP"></a>
</p>

## Por que três pinos?

Em 2011 o Brasil tornou obrigatória a sua própria tomada: três pinos redondos, o terra um pouco abaixo dos outros
dois e dois tamanhos de pino, para o plugue grosso não entrar na tomada fina. Quase nenhum outro país usa. A
imprensa chamou de padrão jabuticaba: aquilo que só dá aqui.

A tomada tem companhia: boleto, Pix, CPF para tudo e cliente que só fala por WhatsApp. Os agentes de IA chegam
prontos para o resto do mundo e travam nas nossas jabuticabas.

> [!NOTE]
> **E o Open Finance?** Regulado pelo [Banco Central](https://www.bcb.gov.br/estabilidadefinanceira/openfinance),
> ele deixa uma instituição ler a sua conta em outro banco, com o seu consentimento, e os grandes bancos são
> obrigados a participar. Mas só instituições autorizadas entram nele: para chegar ao seu agente, os seus dados
> passam por uma delas. E a [API de pagamentos](https://openbanking-brasil.github.io/openapi/swagger-apis/payments/)
> só inicia Pix. Boleto fica de fora.
>
> Os conectores de banco daqui usam a API do próprio banco, com o seu certificado, de um servidor seu, sem empresa
> no meio. Essa API vai além do Pix: também paga boleto.

## Conectores

| Conector                      | O que o agente pode fazer                                           |
| ----------------------------- | ------------------------------------------------------------------- |
| [`sicoob`](connectors/sicoob) | Ler o saldo e o extrato da conta corrente. Nunca movimenta dinheiro |
| [`inter`](connectors/inter)   | Ler o saldo e o extrato da conta PJ. Nunca movimenta dinheiro       |

| Pacote                      | O que faz                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- |
| [`boleto`](packages/boleto) | Lê os códigos de boleto e Pix de um PDF ou foto. Funciona como CLI                 |
| [`media`](packages/media)   | Converte imagens, vídeos, áudios e PDFs em algo que o agente consegue ver ou ler   |
| [`bank`](packages/bank)     | Certificado, bloqueio de pagamentos e centavos exatos, para os conectores de banco |
| [`server`](packages/server) | Serve as ferramentas de um conector em `/mcp`, só para quem tem a chave            |

## Requisitos

- [Docker](https://docs.docker.com/get-docker/), para rodar
- [Bun](https://bun.sh) 1.3+, para desenvolver

## Início rápido

Prepare o certificado do seu banco como diz o conector do [Sicoob](connectors/sicoob) ou do
[Inter](connectors/inter). Depois:

```bash
cp .env.example .env   # escolha os conectores em COMPOSE_PROFILES e preencha as variáveis
docker compose up -d
```

E ligue o seu agente na mesma máquina, com a porta e a chave de cada conector:

| Conector | Endereço                    | Chave        |
| -------- | --------------------------- | ------------ |
| `sicoob` | `http://127.0.0.1:3012/mcp` | `SICOOB_KEY` |
| `inter`  | `http://127.0.0.1:3013/mcp` | `INTER_KEY`  |

```bash
export SICOOB_KEY=...   # a mesma do .env
codex mcp add sicoob --url http://127.0.0.1:3012/mcp --bearer-token-env-var SICOOB_KEY
claude mcp add --transport http sicoob http://127.0.0.1:3012/mcp --header "Authorization: Bearer $SICOOB_KEY"
```

## Desenvolvimento

```bash
bun install
bun run check
bun run test
```

## Licença

[MIT](LICENSE)
