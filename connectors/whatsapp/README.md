# WhatsApp

Dá a um agente de IA acesso ao WhatsApp, como servidor MCP. O [WAHA](https://waha.devlike.pro/) mantém a conexão
com o WhatsApp; as configurações escolhem o que o agente pode ler e para quem pode escrever.

## Configuração

| Variável | Padrão | Significado |
|---|---|---|
| `READ_SESSION` | vazio | Sessão do WAHA que o agente lê. Vazio: sem ferramentas de leitura |
| `READ_CHATS` | `saved` | Conversas que pode ler: `saved` (só contatos salvos) ou `all` |
| `READ_GROUPS` | `false` | Se pode ler grupos, inclusive mensagens de quem você não salvou |
| `SEND_SESSION` | vazio | Sessão que envia, sempre só para contatos salvos. Vazio: sem envio |
| `CONTACTS_SESSION` | `READ_SESSION`, senão `SEND_SESSION` | De qual celular vêm os contatos salvos |
| `TRANSCRIBE_URL` | vazio | Servidor que transcreve áudios. Ativa `transcribe_audio` e a transcrição de vídeos |

Defina `READ_SESSION`, `SEND_SESSION` ou as duas. Por exemplo, `READ_SESSION=personal` deixa o agente ler o seu
número, e `SEND_SESSION=assistant` dá a ele um número próprio que escreve para os seus contatos. Status, canais e
listas de transmissão nunca são lidos. Todas as variáveis estão em [`.env.example`](../../.env.example).

## Ferramentas

| Ferramenta | O que devolve |
|---|---|
| `list_chats`, `find_chat`, `read_chat` | Conversas recentes, qualquer conversa por nome ou número, e as mensagens de uma |
| `view_image` | Uma imagem ou figurinha, como JPEG que o agente consegue ver |
| `view_video` | Quadros de um vídeo ou GIF e a transcrição da fala, com tempos |
| `read_pdf` | O texto e imagens das páginas de um PDF, com senha se for preciso |
| `read_bill` | Os códigos de boleto e Pix de uma conta, e se quem enviou é um contato salvo |
| `transcribe_audio` | Um áudio como texto |
| `send_message`, `read_messages` | Mensagens para e de contatos salvos, no número que envia |

As ferramentas de leitura nunca enviam. Mídias com mais de um mês costumam ter expirado nos servidores do
WhatsApp. [Como as ferramentas funcionam](docs/tools.md).

## Como rodar

Na raiz do repositório:

```bash
cp .env.example .env   # preencha os valores
docker compose up -d
```

Conecte um número à sessão `default` no painel do WAHA, em `http://127.0.0.1:3010/dashboard/`, e coloque o nome
dela em `READ_SESSION` ou `SEND_SESSION`. O conector atende em `http://127.0.0.1:3011/mcp` e exige
`Authorization: Bearer $WHATSAPP_TOKEN`.

## Transcrição

Áudios e vídeos são transcritos por qualquer servidor com a API de transcrição da OpenAI. Para não mandar o
áudio para fora, rode o Whisper na mesma máquina com o [Speaches](https://speaches.ai):

```bash
COMPOSE_PROFILES=whisper
TRANSCRIBE_URL=http://whisper:8000/v1
```

Na primeira vez, ele baixa o modelo (cerca de 500 MB). Num processador de 16 núcleos, um áudio de um minuto
leva uns 10 segundos. Para usar o [Groq](https://console.groq.com/docs/speech-to-text):

```bash
TRANSCRIBE_URL=https://api.groq.com/openai/v1
TRANSCRIBE_KEY=gsk_...
TRANSCRIBE_MODEL=whisper-large-v3-turbo
```

## Desenvolvimento

```bash
bun run test   # as ferramentas contra um WAHA falso
```

[Verificações num ambiente rodando](docs/checks.md).
