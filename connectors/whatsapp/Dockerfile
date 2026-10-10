# Built from the repository root, because read_bill runs packages/boleto.
FROM node:22-alpine
# ImageMagick converts every image format to JPEG, which every agent's model can see.
# The font lets SVG text render instead of empty boxes. ffmpeg converts audio for transcription
# and takes frames from videos. Poppler reads PDF text and renders PDF pages. qpdf unlocks PDFs,
# with the password on stdin.
RUN apk add --no-cache imagemagick imagemagick-heic imagemagick-jpeg imagemagick-svg imagemagick-tiff imagemagick-webp font-dejavu ffmpeg poppler-utils qpdf
COPY connectors/whatsapp/src/policy.xml /etc/ImageMagick-7/policy.xml
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# Every workspace's package.json, which bun needs to match the lockfile.
COPY --parents connectors/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --production --filter @tres-pinos/whatsapp && rm /usr/local/bin/bun
COPY packages/boleto/src packages/boleto/src
COPY connectors/whatsapp/src connectors/whatsapp/src
WORKDIR /app/connectors/whatsapp
CMD ["node", "src/gateway.mjs"]
