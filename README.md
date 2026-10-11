<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="Três Pinos">
</p>

<h1 align="center">Três pinos, nenhum adaptador.</h1>

<p align="center">
  A tomada brasileira para agentes de IA: um conector MCP de código aberto,
  <br>
  que você hospeda, para ler WhatsApp, boletos e Pix.
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

> [!WARNING]
> O conector do WhatsApp usa o WhatsApp Web por meio do [WAHA](https://waha.devlike.pro/), que não é oficial.
> Um número conectado assim pode ser banido. Este projeto não tem relação com o WhatsApp nem com a Meta.

## Conectores

| Conector | O que o agente pode fazer |
|---|---|
| [`whatsapp`](connectors/whatsapp) | Ler conversas, imagens, vídeos, PDFs e contas, e transcrever áudios. Nunca envia mensagens |

| Pacote | O que faz |
|---|---|
| [`boleto`](packages/boleto) | Lê os códigos de boleto e Pix de um PDF ou foto. Os conectores usam, e funciona como CLI |

## Requisitos

- [Docker](https://docs.docker.com/get-docker/), para rodar
- [Bun](https://bun.sh) 1.3+, para desenvolver

## Início rápido

```bash
cp .env.example .env   # preencha as senhas e chaves
docker compose up -d
```

Leia o QR no painel do WAHA, em `http://127.0.0.1:3010/dashboard/`, para conectar o seu número. O que o agente
pode ler se escolhe no `.env`; veja o [conector do WhatsApp](connectors/whatsapp).

Depois, ligue o seu agente na mesma máquina:

```bash
export WHATSAPP_KEY=...   # a mesma do .env
codex mcp add whatsapp --url http://127.0.0.1:3011/mcp --bearer-token-env-var WHATSAPP_KEY
claude mcp add --transport http whatsapp http://127.0.0.1:3011/mcp --header "Authorization: Bearer $WHATSAPP_KEY"
```

## Desenvolvimento

```bash
bun install
bun run test
```

## Licença

[MIT](LICENSE)
