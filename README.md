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

> [!WARNING]
> **Sem WhatsApp, por enquanto.** O conector do WhatsApp usava o [WAHA](https://waha.devlike.pro/), que entra pelo
> WhatsApp Web sem ser oficial. O número pessoal do autor foi bloqueado pelo WhatsApp enquanto estava ligado ao
> WAHA, com o conector só lendo mensagens, sem nunca enviar. Como não dá para oferecer o conector sem pôr o seu
> número em risco, ele saiu do projeto. Se você usa o WAHA no seu número, só ler não evita um bloqueio.
>
> Estamos estudando um jeito de trazer o WhatsApp de volta sem pôr número nenhum em risco. Até lá, o foco é o banco
> e as ferramentas: PDF, boleto e Pix.
>
> Se você já rodava o conector, atualize o repositório e rode `docker compose down --remove-orphans`, que remove o
> WAHA sem subir nada. Depois apague a pasta `sessions/` e remova o aparelho em **Aparelhos conectados**, no
> WhatsApp do celular.

## Conectores

| Conector                      | O que o agente pode fazer                                           |
| ----------------------------- | ------------------------------------------------------------------- |
| [`sicoob`](connectors/sicoob) | Ler o saldo e o extrato da conta corrente. Nunca movimenta dinheiro |

| Pacote                      | O que faz                                                                        |
| --------------------------- | -------------------------------------------------------------------------------- |
| [`boleto`](packages/boleto) | Lê os códigos de boleto e Pix de um PDF ou foto. Funciona como CLI               |
| [`media`](packages/media)   | Converte imagens, vídeos, áudios e PDFs em algo que o agente consegue ver ou ler |

## Requisitos

- [Docker](https://docs.docker.com/get-docker/), para rodar
- [Bun](https://bun.sh) 1.3+, para desenvolver

## Início rápido

Prepare o certificado e o app do Sicoob como diz o [conector do Sicoob](connectors/sicoob). Depois:

```bash
cp .env.example .env   # preencha as variáveis
docker compose up -d
```

E ligue o seu agente na mesma máquina:

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
