# Como as ferramentas funcionam

As mídias chegam de qualquer contato, então cada conversão tem limite de tamanho, de tempo e de formato. O
código fica em `src/media.mjs`.

| Ferramenta | Como funciona |
|---|---|
| `view_image` | Converte toda imagem para JPEG, porque os agentes não veem AVIF, HEIC, BMP nem SVG. `src/policy.xml` limita os formatos, o tamanho e o número de quadros que o ImageMagick aceita |
| `view_video` | Vídeos de até 200 MB. Os quadros vão do início até meio segundo antes do fim, com pelo menos um segundo entre eles; com `times`, saem nos segundos pedidos. O ffmpeg só abre arquivos de áudio e vídeo, então um arquivo disfarçado não lê outros |
| `read_pdf` | O Poppler extrai o texto (`pdftotext`) e as imagens das páginas (`pdftoppm`). O qpdf recebe a senha pela entrada padrão, para ela nunca aparecer numa linha de comando |
| `read_bill` | Roda o [`packages/boleto`](../../../packages/boleto) num processo próprio. `confirmed` quer dizer que o código foi lido certo, não que a conta é verdadeira; por isso o resultado diz se quem enviou é um contato salvo |
| `transcribe_audio` | Converte o áudio para Opus e envia ao servidor de `TRANSCRIBE_URL`. No Groq, ative o Zero Data Retention em [Data Controls](https://console.groq.com/settings/data-controls) para ele não guardar o áudio |

As outras mídias têm limite de 25 MB.

## Fixtures

`fixtures/` tem um áudio falado em cada formato, vídeos em 13 formatos, uma imagem SVG, uma figurinha animada e
PDFs com acentos, página escaneada, página girada, 30 páginas, senhas e arquivos quebrados. As contas vêm de
`packages/boleto/fixtures`.
