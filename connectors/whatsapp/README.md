# WhatsApp

Servidor MCP que deixa um agente de IA ler o seu WhatsApp. Ele nunca envia mensagens. O
[WAHA](https://waha.devlike.pro/) mantém a conexão com o WhatsApp.

## Rodar

Na raiz do repositório, com o `.env` preenchido:

```bash
docker compose up -d
```

1. Leia o QR da sessão `default` no painel do WAHA, em `http://127.0.0.1:3010/dashboard/`.
2. Ligue o agente em `http://127.0.0.1:3011/mcp`, com o cabeçalho `Authorization: Bearer $WHATSAPP_KEY`.

## Configuração

| Variável | Padrão | O que faz |
|---|---|---|
| `WHATSAPP_KEY` | obrigatória | Chave que o agente envia. Pelo menos 32 caracteres |
| `READ_SESSION` | obrigatória | Sessão do WAHA que o agente lê |
| `READ_CHATS` | `saved` | `saved`: só conversas com contatos salvos. `all`: todas |
| `READ_GROUPS` | `false` | `true` libera grupos, inclusive mensagens de quem você não salvou |
| `TRANSCRIBE_URL` | vazio | Servidor de transcrição. Ativa `transcribe_audio` e a fala dos vídeos |

Status, canais e listas de transmissão nunca são lidos.

## Ferramentas

| Ferramenta | O que devolve |
|---|---|
| `list_chats`, `find_chat`, `read_chat` | Conversas recentes, qualquer conversa por nome ou número, e as mensagens de uma |
| `view_image` | Uma imagem ou figurinha, em JPEG |
| `view_video` | Quadros de um vídeo ou GIF e a fala transcrita, com tempos |
| `read_pdf` | O texto e imagens das páginas de um PDF, com senha se precisar |
| `read_bill` | Os códigos de boleto e Pix de uma conta, e se quem enviou é um contato salvo |
| `transcribe_audio` | Um áudio em texto |

Mídias antigas podem já ter saído dos servidores do WhatsApp; nesse caso a ferramenta avisa. Detalhes em
[como as ferramentas funcionam](docs/tools.md).

## Transcrição

Qualquer servidor com a API de transcrição da OpenAI serve. Para o áudio não sair da sua máquina, use o Whisper
local com o [Speaches](https://speaches.ai):

```bash
COMPOSE_PROFILES=whisper
TRANSCRIBE_URL=http://whisper:8000/v1
```

Na primeira vez ele baixa o modelo, cerca de 500 MB. Num processador de 16 núcleos, um minuto de áudio leva uns
10 segundos.

Ou use o [Groq](https://console.groq.com/docs/speech-to-text):

```bash
TRANSCRIBE_URL=https://api.groq.com/openai/v1
TRANSCRIBE_KEY=gsk_...
TRANSCRIBE_MODEL=whisper-large-v3-turbo
```

## Desenvolvimento

```bash
bun run test   # as ferramentas contra um WAHA falso
```

Para conferir um ambiente rodando, veja [verificações](docs/checks.md).
