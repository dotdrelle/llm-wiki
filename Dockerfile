FROM node:22-alpine AS builder
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /build/dist ./
EXPOSE 3000
VOLUME /workspace
WORKDIR /workspace
ENTRYPOINT ["node", "/app/bin/wiki.js"]
