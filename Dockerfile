FROM node:26-slim AS builder
WORKDIR /build
RUN npm install --global pnpm@10.29.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod && mkdir -p /dist-workspace

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/lib/node_modules/pnpm \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/dist ./
COPY --from=builder --chown=node:node /build/package.json ./
COPY --from=builder --chown=node:node /dist-workspace /workspace
EXPOSE 3000 3333
VOLUME /workspace
WORKDIR /workspace
USER node
ENTRYPOINT ["node", "/app/bin/wiki.js"]
