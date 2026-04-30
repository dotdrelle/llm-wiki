FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./
COPY package.json ./
EXPOSE 3000
VOLUME /workspace
WORKDIR /workspace
ENTRYPOINT ["node", "/app/bin/wiki.js"]
