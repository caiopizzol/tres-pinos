# syntax=docker/dockerfile:1
# Built from the repository root, like the other connectors.
FROM node:22-alpine
COPY --from=oven/bun:1.3.14-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# Every workspace's package.json, which bun needs to match the lockfile.
COPY --parents connectors/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile --production --filter @tres-pinos/inter && rm /usr/local/bin/bun
COPY connectors/inter/src connectors/inter/src
WORKDIR /app/connectors/inter
USER node
CMD ["node", "src/server.mjs"]
