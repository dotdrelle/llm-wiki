# Repository Guide

## Goal

`llm-wiki` is a local-first Node.js 22 CLI that maintains a persistent markdown wiki from source documents, then regenerates derived markdown deliverables from templates.

## Architecture

- `bin/wiki.ts`: Commander entrypoint — registers all subcommands.
- `src/config`: config loading and zod validation for `.wikirc.yaml`.
- `src/services`: orchestration layer for all features (see list below).
- `src/prompts`: prompt builders for LLM interactions.
- `src/utils`: path safety, hashing, JSON extraction, markdown helpers, fs utilities.
- `src/chat/`: browser chat UI HTML generation and theming (`chatHtml.ts`, `theme.ts`).

### Commands (`src/commands/`)

- `serve.ts`: local HTTP server — renders `wiki/` and deliverables as markdown, serves `/graph` (D3 source/wiki relation graph with live refresh), `/chat` (browser chat UI with MCP tool calling), and `/api/chat` + `/api/mcp` as server-side proxies for Docker/manager mode. Also manages workspace skills under `.wiki/skills/`.
- `doctor.ts`: provider/config diagnostics; prints suggested `.wikirc.yaml` changes. Use `--apply` to write them directly (replaces the old interactive-confirmation flow).
- `index.ts`: `wiki index` — builds or refreshes the local LanceDB vector index.
- `ingest.ts`: reads `raw/untracked/`, LLM-generates wiki updates, archives sources to `raw/ingested/`, then auto-runs `refresh`.
- `build.ts`: generates deliverables from templates; `--plan` shows batches and token estimates without calling the LLM.
- `refresh.ts`: rebuilds only stale deliverables from `.wiki/build-state.json`.
- `export.ts`: expands deliverable citation markers into inline source detail; `--polish` adds a second editorial pass.
- `query.ts`: answers a freeform question from wiki context; `--save` writes to `wiki/answers/`.
- `lint.ts`: static checks — dead links, orphan pages, missing source citations, stale deliverables, unresolved `[[INSTRUCTION:]]` slots; `--with-llm` adds semantic checks; `--json` emits structured output.
- `mcp.ts`: stdio MCP server (for Claude Desktop / Claude Code integration).
- `mcpHttp.ts`: Streamable HTTP MCP server (for manager/agent use, with optional bearer token auth and TLS).
- `init.ts`: scaffolds a new workspace from `scaffold/workspace`.

### Services (`src/services/`)

- `workspaceService.ts`: workspace IO, path resolution, file enumeration.
- `ingestService.ts`: source-to-wiki LLM pipeline.
- `buildService.ts`: template-slot batching and LLM generation.
- `refreshService.ts`: stale-deliverable detection and rebuild.
- `exportService.ts`: citation expansion and editorial polish.
- `queryService.ts`: single-question retrieval and answer generation.
- `lintService.ts`: static and semantic lint checks.
- `retrievalService.ts`: keyword + optional vector retrieval, context assembly.
- `vectorIndexService.ts`: LanceDB index build, incremental update, and vector search.
- `embeddingService.ts`: calls `/v1/embeddings` for vector indexing.
- `rerankService.ts`: calls `/v1/rerank` for optional result re-ranking.
- `llmService.ts`: LLM provider abstraction (OpenAI-compatible, Anthropic, Ollama).
- `mcpServer.ts`: MCP tool definitions (`wiki_list_pages`, `wiki_read_page`, `wiki_read_pages`, `wiki_write_page`, `wiki_search_context`, `wiki_collect_context`, `wiki_list_ingested_sources`, `wiki_read_ingested_source`).
- `promptBudgetService.ts`: token budget calculations for context trimming.
- `rateLimiter.ts`: per-provider request rate limiting with retry logic.
- `traceLogger.ts`: structured trace logging to `.wiki/logs/`.

### Other

- `scaffold/workspace`: files copied by `wiki init`.
- `SKILL.md`: workspace operator skill definition (used by AI assistants in manager/Cowork mode).
- `examples`: runnable sample inputs.
- `tests`: Vitest coverage for config, template parsing, build flow, and path safety.
- `Dockerfile` / `docker-compose.yml`: containerized CLI and web UI entrypoints.
- `docs/`: user-facing reference documentation (commands, configuration, docker, mcp, templates, vector-search).

## Constraints

- Local-first only. Vector index uses LanceDB stored on disk under `.wiki/vector-index/` — no external database.
- Deliverables must remain regenerable and stable in Git.
- Never write outside the workspace root.
- Generated deliverables must not invent missing information.
- `wiki doctor` prints suggested `.wikirc.yaml` changes in all modes. `--apply` writes them directly; without it, no file is modified.
- Keep Docker CLI usage and server usage separate: `wiki` is for one-shot commands; `serve` is the long-running web UI.
- The Docker runtime image must include production dependencies. The built CLI still imports runtime packages; `serve` resolves `d3/dist/d3.min.js` and `marked.umd.js` from `node_modules`.
- For Ollama diagnostics, local process env detection is valid only for local Ollama. Remote/containerized Ollama needs `.wikirc.yaml` hints such as `flashAttention` and `kvCacheType`.
- MCP auth: `wiki mcp` requires `WIKI_MCP_AUTH_TOKEN` env var. `wiki mcp-http` validates Bearer tokens on each request; the serve proxy injects the token server-side so the browser never sees it.
- Workspace skills live under `.wiki/skills/` (name regex `^[a-zA-Z0-9_-]{1,60}$`); they are scoped to the workspace and exposed through the chat UI.

## Common Commands

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint .
pnpm test               # vitest run
pnpm run build          # tsup
pnpm dev ingest         # run without building (Node experimental strip-types)
```

Docker:

```bash
docker compose build
docker compose up serve
docker compose --profile cli run --rm wiki doctor
docker compose --profile cli run --rm wiki doctor --apply   # write suggestions
docker compose --profile cli run --rm wiki ingest
docker compose --profile cli run --rm wiki lint
docker compose --profile cli run --rm wiki index
```

`EXPOSE 3000` does not start `wiki serve`. The `serve` service explicitly runs `serve --port 3000`; the `wiki` service is reserved for one-shot CLI commands. Both mount the same workspace, so changes from `ingest` are visible in the web UI after browser refresh.

## Config Notes

Important `.wikirc.yaml` keys:

```yaml
llm:
  provider: ollama
  baseUrl: http://host.docker.internal:11434/v1
  numCtx: 32768
  flashAttention: true
  kvCacheType: q8_0

build:
  slotBatchSize: 3

retrieval:
  maxContextFiles: 5
  maxChunksPerPage: 2
  maxChunkChars: 3000
  maxSourceChars: 8000
  vector:
    enabled: true # run `wiki index` to build or refresh the local index
    embeddingModel: BAAI/bge-m3
    rerankEnabled: false # scaffold default; set true only when /v1/rerank is available
    rerankerModel: BAAI/bge-reranker-v2-m3
    topK: 120
    rerankTopK: 80
    maxResults: 6
```

When changing `slotBatchSize`, `maxContextFiles`, `maxChunkChars`, or `numCtx`, run `wiki doctor` and make sure its final suggestions are internally consistent.
