# Media

Converte o que chega de qualquer remetente em algo que o agente consegue ver ou ler: imagens em JPEG, vídeos em
quadros, áudios em texto e PDFs em texto e imagens das páginas. Fica aqui para os próximos conectores, como o de
e-mail. Nenhum conector usa ainda.

## Requisitos

- [Node.js](https://nodejs.org) 22.18+
- [ImageMagick](https://imagemagick.org), [ffmpeg](https://ffmpeg.org), [Poppler](https://poppler.freedesktop.org)
  e [qpdf](https://qpdf.readthedocs.io)

## Funções

Em `src/media.mjs`, menos `readBill`, em `src/bills.mjs`.

| Função        | Como funciona                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toJpeg`      | Converte toda imagem para JPEG, porque os agentes não veem AVIF, HEIC, BMP nem SVG. `src/policy.xml` limita os formatos, o tamanho e o número de quadros que o ImageMagick aceita                                           |
| `videoFrames` | Os quadros vão do início até meio segundo antes do fim, com pelo menos um segundo entre eles; com `times`, saem nos segundos pedidos. O ffmpeg só abre arquivos de áudio e vídeo, então um arquivo disfarçado não lê outros |
| `readPdf`     | O Poppler extrai o texto (`pdftotext`) e as imagens das páginas (`pdftoppm`). O qpdf recebe a senha pela entrada padrão, para ela nunca aparecer numa linha de comando                                                      |
| `readBill`    | Roda o [`packages/boleto`](../boleto) num processo próprio. `confirmed` quer dizer que o código foi lido certo, não que a conta é verdadeira                                                                                |
| `transcribe`  | Converte o áudio para Opus e envia ao servidor de `TRANSCRIBE_URL`                                                                                                                                                          |

Cada programa que elas rodam tem limite de tempo e de tamanho da saída. O tamanho do arquivo de entrada fica com
quem chama: limite antes de converter.

## Transcrição

Qualquer servidor com a API de transcrição da OpenAI serve, como o Whisper local do [Speaches](https://speaches.ai)
ou o [Groq](https://console.groq.com/docs/speech-to-text). No Groq, ative o Zero Data Retention em
[Data Controls](https://console.groq.com/settings/data-controls) para ele não guardar o áudio.

| Variável           | O que faz                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `TRANSCRIBE_URL`   | Endereço do servidor, como `https://api.groq.com/openai/v1`. Sem ele, não há transcrição |
| `TRANSCRIBE_KEY`   | Chave do servidor, se ele pedir                                                          |
| `TRANSCRIBE_MODEL` | Padrão: `Systran/faster-whisper-small`. No Groq, `whisper-large-v3-turbo`                |

## Desenvolvimento

`fixtures/` tem um áudio falado em cada formato, vídeos em 13 formatos, uma imagem SVG, uma figurinha animada e
PDFs com acentos, página escaneada, página girada, 30 páginas, senhas e arquivos quebrados. As contas vêm de
`packages/boleto/fixtures`. O CI passa todas pela imagem; na raiz do repositório:

```bash
docker build -f packages/media/Dockerfile -t media . && docker run --rm media
```

Sem `TRANSCRIBE_URL`, as transcrições são puladas. Para conferir também essas, passe as variáveis com `-e`.
