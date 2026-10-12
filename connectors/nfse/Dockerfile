# syntax=docker/dockerfile:1
# Built from the repository root, like the other connectors.
FROM node:22-alpine
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# Every workspace's package.json, which bun needs to match the lockfile.
COPY --parents connectors/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --production --filter @tres-pinos/nfse-connector && rm /usr/local/bin/bun
COPY packages/api/src packages/api/src
COPY packages/nfse/src packages/nfse/src
COPY packages/server/src packages/server/src
COPY connectors/nfse/src connectors/nfse/src
# Sign-ins are kept here, on a volume; the folder belongs to node so a new volume does too.
RUN mkdir /data && chown node:node /data
WORKDIR /app/connectors/nfse
USER node
CMD ["node", "src/server.mjs"]
