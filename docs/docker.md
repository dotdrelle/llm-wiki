# Docker

A `Dockerfile` and `docker-compose.yml` are included. The image builds the TypeScript CLI into `dist/` and installs production dependencies in the runtime layer (required by runtime-loaded packages such as the local D3 bundle used by `wiki serve`).

## Build

```bash
cd llm-wiki
docker compose build
```

## Workspace

Set `WIKI_WORKSPACE` to the path of an initialized wiki workspace. It is mounted as `/workspace` inside the container. Do not mount the source checkout as the workspace.

```bash
export WIKI_WORKSPACE=/path/to/my/workspace
```

## One-shot CLI commands

Use the `wiki` service (profile `cli`) for any one-off command:

```bash
docker compose --profile cli run --rm wiki init
docker compose --profile cli run --rm wiki doctor
docker compose --profile cli run --rm wiki ingest
docker compose --profile cli run --rm wiki build
docker compose --profile cli run --rm wiki index
docker compose --profile cli run --rm wiki query "your question"
```

## Web UI

Use the `serve` service for a persistent browser UI:

```bash
docker compose up serve
# → http://localhost:3100
```

`EXPOSE 3000` in the Dockerfile does not start a server by itself — only the `serve` service does. Both `wiki` and `serve` mount the same workspace: changes from `ingest` appear in the browser after a refresh.

## MCP HTTP server

```bash
docker compose --profile mcp-http up mcp-http
# → http://localhost:3101/mcp
```

With TLS:

```bash
WIKI_MCP_ACCESS_KEY=your-secret-key \
WIKI_MCP_TLS_CERT_PATH=/certs/fullchain.pem \
WIKI_MCP_TLS_KEY_PATH=/certs/privkey.pem \
WIKI_CERTS=/absolute/path/to/certs \
docker compose --profile mcp-http up mcp-http
```

## API keys

The compose file forwards `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` automatically:

```bash
OPENAI_API_KEY=sk-... docker compose --profile cli run --rm wiki build
ANTHROPIC_API_KEY=sk-ant-... docker compose --profile cli run --rm wiki build
```

## Ollama

**macOS** — run Ollama natively on the host and point `.wikirc.yaml` at the Docker-internal hostname:

```yaml
llm:
  provider: ollama
  baseUrl: http://host.docker.internal:11434/v1
```

**Linux + NVIDIA GPU** — start the bundled Ollama container:

```bash
docker compose --profile gpu up ollama
```

```yaml
llm:
  provider: ollama
  baseUrl: http://ollama:11434/v1
```

## MLX (Apple Silicon)

Run an MLX server natively and point the container at it:

```bash
mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080 --max-tokens 4096
```

```yaml
llm:
  provider: openai-compatible
  model: mlx-community/Qwen2.5-7B-Instruct-4bit
  baseUrl: http://host.docker.internal:8080/v1
  numCtx: 16384

build:
  slotBatchSize: 1

retrieval:
  maxContextFiles: 4
  maxChunkChars: 2500
```

Start with `numCtx: 8192` or `16384`. Larger context windows can exceed memory once the KV cache is included, even when 4-bit weights fit comfortably on disk.
