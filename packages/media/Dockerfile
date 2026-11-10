# syntax=docker/dockerfile:1
# The converters with their fixtures, to run scripts/check.mjs. Built from the repository root, because bills
# run packages/boleto.
FROM node:22-alpine
# ImageMagick converts every image format to JPEG, which every agent's model can see.
# The font lets SVG text render instead of empty boxes. ffmpeg converts audio for transcription
# and takes frames from videos. Poppler reads PDF text and renders PDF pages. qpdf unlocks PDFs,
# with the password on stdin.
RUN apk add --no-cache imagemagick imagemagick-heic imagemagick-jpeg imagemagick-svg imagemagick-tiff imagemagick-webp font-dejavu ffmpeg poppler-utils qpdf
COPY packages/media/src/policy.xml /etc/ImageMagick-7/policy.xml
# ImageMagick tries inkscape on an SVG before librsvg. Since 7.1.2-34 the policy refuses that call with an error,
# which fails the read; without the delegate, librsvg renders it.
RUN sed -i '/decode="svg:decode"/d' /etc/ImageMagick-7/delegates.xml
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# Every workspace's package.json, which bun needs to match the lockfile.
COPY --parents connectors/*/package.json packages/*/package.json skills/*/package.json ./
RUN bun install --frozen-lockfile --production --filter @tres-pinos/media && rm /usr/local/bin/bun
COPY packages/boleto/src packages/boleto/src
COPY packages/boleto/fixtures packages/boleto/fixtures
COPY packages/media/src packages/media/src
COPY packages/media/scripts packages/media/scripts
COPY packages/media/fixtures packages/media/fixtures
WORKDIR /app/packages/media
USER node
CMD ["node", "scripts/check.mjs"]
