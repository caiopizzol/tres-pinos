# Como as ferramentas funcionam

As mídias chegam de qualquer contato, então cada conversor roda com limites: tamanho, tempo e formatos aceitos.
Os conversores ficam em `src/media.mjs`.

| Ferramenta | Como funciona |
|---|---|
| `view_image` | Converte toda imagem para JPEG, porque os agentes não veem AVIF, HEIC, BMP nem SVG. `src/policy.xml` restringe o ImageMagick aos formatos necessários e limita tamanho e número de quadros |
| `view_video` | Vídeos de até 200 MB. Os quadros vão do início até meio segundo antes do fim, com pelo menos um segundo entre eles. Com `times`, devolve os quadros nesses segundos. O ffmpeg só abre contêineres de áudio e vídeo, então um arquivo disfarçado de playlist não lê outros arquivos |
| `read_pdf` | Usa o Poppler: `pdftotext` para o texto e `pdftoppm` para as páginas. O qpdf abre PDFs com senha recebendo a senha pela entrada padrão, para que ela nunca apareça numa linha de comando |
| `read_bill` | Roda o [`packages/boleto`](../../../packages/boleto) num processo próprio. Um código é `confirmed` quando os dígitos verificadores batem ou duas leituras concordam. Isso prova que o código foi lido certo, não que a conta é verdadeira; por isso o resultado diz se quem enviou é um contato salvo |
| `transcribe_audio` | Converte o áudio para Opus com o ffmpeg e envia ao servidor de `TRANSCRIBE_URL`. Com o Groq, ative **Inference APIs ZDR** nos Data Controls para que ele não guarde cópia |

## Fixtures

`fixtures/` tem um áudio falado por formato, uma imagem SVG, uma figurinha animada com 75 quadros, vídeos em
vários formatos (MP4, MOV, Matroska, WebM, AV1, HEVC, AVI, WMV, MPEG-2, FLV, 3GP e um GIF sem som) e PDFs com
texto, acentos, página escaneada, página girada, 30 páginas, senhas AES-256 e RC4, senha só de dono e arquivos
quebrados. As contas usadas nas verificações são as de `packages/boleto/fixtures`.
