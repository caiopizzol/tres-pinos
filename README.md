<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="Três Pinos">
</p>

<h1 align="center">Três Pinos</h1>

<p align="center">
  Ligue seu agente de IA no Brasil: WhatsApp, boletos, Pix e bancos.
  <br>
  Servidores MCP para Codex, Claude, ChatGPT e Grok, que você hospeda onde quiser.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licença-MIT-1d1d1f" alt="Licença MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-1.3+-1d1d1f" alt="Bun"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-servidor-f7c831?labelColor=1d1d1f" alt="MCP"></a>
</p>

> [!WARNING]
> O conector do WhatsApp usa o WhatsApp Web por meio do [WAHA](https://waha.devlike.pro/), que não é oficial.
> Um número conectado assim pode ser banido. Este projeto não tem relação com o WhatsApp nem com a Meta.

## Conectores

| Conector | O que o agente pode fazer |
|---|---|
| [`whatsapp`](connectors/whatsapp) | Ler conversas, ver imagens e vídeos, ler PDFs e boletos, transcrever áudios e mandar mensagens a contatos salvos |

| Pacote | Para que serve |
|---|---|
| [`boleto`](packages/boleto) | Lê os códigos de boleto e Pix de um PDF ou foto. Usado pelos conectores e também como CLI |

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) para rodar os conectores
- [Bun](https://bun.sh) 1.3+ para desenvolver

## Início rápido

```bash
cp .env.example .env   # preencha os valores
docker compose up -d
```

Depois, conecte um número ao WhatsApp e escolha o que o agente pode ler e enviar. Veja o
[conector do WhatsApp](connectors/whatsapp).

## Desenvolvimento

```bash
bun install
bun run test
```

## Licença

[MIT](LICENSE)
