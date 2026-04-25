FROM node:22-alpine AS builder
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
COPY --from=builder /build/dist /app
EXPOSE 3000
VOLUME /workspace
WORKDIR /workspace
ENTRYPOINT ["node", "/app/bin/wiki.js"]
