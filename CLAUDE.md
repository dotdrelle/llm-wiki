# Repository Guide

## Goal

`llm-wiki` is a local-first Node.js 22 CLI that maintains a persistent markdown wiki from source documents, then regenerates derived markdown deliverables from templates.

## Architecture

- `bin/wiki.ts`: Commander entrypoint.
- `src/config`: config loading and zod validation for `.wikirc.yaml`.
- `src/services`: orchestration for workspace IO, retrieval, ingest, query, build, refresh, lint, and vector index.
- `src/prompts`: prompt builders for LLM interactions.
- `src/utils`: path safety, hashing, JSON extraction, markdown helpers.
- `src/commands/serve.ts`: local wiki UI, index tiles, source graph, and bundled D3 asset serving.
- `src/commands/doctor.ts`: provider/config diagnostics and optional `.wikirc.yaml` correction after user confirmation.
- `src/commands/index.ts`: `wiki index` — builds or refreshes the local LanceDB vector index.
- `src/services/embeddingService.ts`: calls `/v1/embeddings` for vector indexing.
- `src/services/rerankService.ts`: calls `/v1/rerank` for optional result re-ranking.
- `src/services/vectorIndexService.ts`: LanceDB index build, incremental update, and vector search.
- `scaffold/workspace`: files copied by `wiki init`.
- `examples`: runnable sample inputs.
- `tests`: Vitest coverage for config, template parsing, build flow, and path safety.
- `Dockerfile` / `docker-compose.yml`: containerized CLI and web UI entrypoints.
- `docs/`: user-facing reference documentation (commands, configuration, docker, mcp, templates, vector-search).

## Constraints

- Local-first only. Vector index uses LanceDB stored on disk under `.wiki/vector-index/` — no external database.
- Deliverables must remain regenerable and stable in Git.
- Never write outside the workspace root.
- Generated deliverables must not invent missing information.
- `wiki doctor` may update `.wikirc.yaml` only after explicit interactive confirmation. In non-interactive runs it must print suggestions without writing.
- Keep Docker CLI usage and server usage separate: `wiki` is for one-shot commands; `serve` is the long-running web UI.
- The Docker runtime image must include production dependencies. The built CLI still imports runtime packages and `serve` resolves `d3/dist/d3.min.js` from `node_modules`.
- For Ollama diagnostics, local process env detection is valid only for local Ollama. Remote/containerized Ollama needs `.wikirc.yaml` hints such as `flashAttention` and `kvCacheType`.

## Common Commands

```bash
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm test
pnpm run build
```

Docker:

```bash
docker compose build
docker compose up serve
docker compose --profile cli run --rm wiki doctor
docker compose --profile cli run --rm wiki ingest
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
