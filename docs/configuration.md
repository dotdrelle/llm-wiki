# Configuration

The CLI looks for `.wikirc.yaml` or `.wikirc.yml` in the current directory or its parents.
Set `WIKI_CONFIG_PATH` to load a specific config file inside the workspace, for example
`WIKI_CONFIG_PATH=.wikirc.yaml.openai`.

## Generic provider example

```yaml
language: fr

llm:
  provider: openai-compatible
  baseUrl: https://mon-provider.example.com/v1
  model: leur-modele-32b
  apiKey: votre-cle-api

limits:
  requestsPerMinute: 60

retrieval:
  vector:
    enabled: true
    baseUrl: http://infinity.local:7997/v1
    apiKey: votre-cle-vector
    embeddingModel: BAAI/bge-m3
    rerankEnabled: true
    rerankerModel: BAAI/bge-reranker-v2-m3
    requestsPerMinute: 1000
```

Run `wiki config --effective` to print the merged configuration with provenance
(`default`, `preset:<name>`, `file`, or `env`).

Presets (`albert`, `openai`, `ollama`, `nvidia`) are optional shortcuts only.
The generic declaration above is the first-class form, and any explicit file
value overrides preset/default values.

## Full reference

The scaffold intentionally omits most of these keys. They are shown here for
advanced tuning and for understanding what `wiki config --effective` resolves
from schema defaults, presets, file values, and MCP/TLS environment variables.

```yaml
language: fr

llm:
  provider: ollama
  model: qwen2.5:14b
  apiKey: ollama
  baseUrl: http://127.0.0.1:11434/v1
  temperature: 0.1
  timeoutMs: 600000
  numCtx: 32768
  flashAttention: true
  kvCacheType: q8_0

limits:
  requestsPerMinute: 10
  maxInFlightRequests: 3
  dailyInputTokens: 1000000
  targetInputTokensPerCall: 40000
  maxInputTokensPerCall: 50000
  maxProfileChars: 4000

build:
  refreshOnIngest: true
  slotBatchSize: 8
  maxBuildContextChars: 24000

retrieval:
  maxContextFiles: 5
  maxChunksPerPage: 2
  maxChunkChars: 3000
  maxSourceChars: 8000
  buildStrategy: bm25
  vector:
    enabled: false
    baseUrl: http://127.0.0.1:7997/v1
    apiKey: optional-vector-key
    requestsPerMinute: 10
    timeoutMs: 600000
    embeddingModel: BAAI/bge-m3
    rerankEnabled: true
    rerankerModel: BAAI/bge-reranker-v2-m3
    topK: 48
    rerankTopK: 24
    maxResults: 6
```

## Top-level

| Key        | Description                                                                                                                                                | Default |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `preset`   | Optional shortcut: `albert`, `openai`, `ollama`, or `nvidia`. Explicit file values always win.                                                             | —       |
| `wikiRoot` | Optional workspace root override. Normally omit it and use the directory containing `.wikirc.yaml` or `--workspace`.                                       | config directory |
| `language` | Language for all LLM-generated content. Use a natural-language name such as `french`, `english`, or `español`. Overrides the language of source documents. | `fr`    |

### Presets

Presets reduce typing only; they are never required. The merge order is
`field in file > preset > schema default`.

| Preset   | Applies                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| `albert` | Etalab Albert base URL, BGE-M3 embeddings/reranker, vector enabled, BM25 build strategy, RPM 100 |
| `openai` | OpenAI base URL, vector disabled, BM25 build strategy                                          |
| `ollama` | Local Ollama base URL, `apiKey: ollama`, `numCtx: 32768`, vector disabled, RPM 50               |
| `nvidia` | NVIDIA OpenAI-compatible base URL, vector disabled, RPM 40                                      |

## `llm`

| Key              | Description                                                                                                                                          | Default            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `provider`       | `openai`, `ollama`, `anthropic`, `openai-compatible`                                                                                                 | `openai`           |
| `model`          | Model name passed to the provider                                                                                                                    | `gpt-5-mini`       |
| `apiKey`         | API key for this workspace. Keep the provider key here.                                                                                              | —                  |
| `baseUrl`        | Provider base URL                                                                                                                                    | provider-dependent |
| `temperature`    | Sampling temperature. Valid range: `0` to `2`. Some providers/models ignore or reject non-default temperatures.                                      | `0.1`              |
| `timeoutMs`      | Request timeout in milliseconds. Must be positive.                                                                                                   | `600000`           |
| `numCtx`         | Active context window of the LLM server, in tokens. Useful for Ollama and local/OpenAI-compatible servers so `wiki doctor` can tune context budgets. | —                  |
| `flashAttention` | Ollama hint for remote/containerized servers when env vars cannot be detected                                                                        | —                  |
| `kvCacheType`    | Ollama KV cache quantization: `f16`, `q8_0`, or `q4_0`                                                                                               | —                  |

API key resolution is direct: `llm.apiKey` is used as written. Ollama defaults
to `ollama` when no key is set.

### Provider snippets

**OpenAI**

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: YOUR_API_KEY_HERE
```

**Anthropic**

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  apiKey: YOUR_API_KEY_HERE
```

**Ollama (local)**

```yaml
llm:
  provider: ollama
  model: qwen2.5:14b
  baseUrl: http://127.0.0.1:11434/v1
  numCtx: 32768
  flashAttention: true
  kvCacheType: q8_0
```

**MLX / OpenAI-compatible**

```yaml
llm:
  provider: openai-compatible
  model: mlx-community/Qwen2.5-7B-Instruct-4bit
  baseUrl: http://127.0.0.1:8080/v1
  numCtx: 16384
```

### `numCtx`

`numCtx` should describe the real context window currently active on the LLM
server, not the theoretical maximum supported by the model.

Set it for:

- `provider: ollama`
- `provider: openai-compatible` when backed by MLX, vLLM, LM Studio, llama.cpp,
  or an internal local server
- remote or Docker-hosted local servers where `wiki doctor` cannot inspect the
  server runtime configuration

It lets `wiki doctor` estimate whether prompts for `ingest`, `build`, `query`,
and MCP-driven retrieval fit into the available context, then recommend
`slotBatchSize`, `maxContextFiles`, `maxChunkChars`, and `maxBuildContextChars`.

For cloud `provider: openai` or `provider: anthropic`, `numCtx` is usually not
needed unless you want to override the budget used by `wiki doctor`.

If `numCtx` is set too high, `wiki doctor` may recommend prompts that are too
large for the actual server and later requests can fail or be truncated. If it
is set too low, recommendations will be conservative.

### Ollama performance tuning

Set these environment variables before `ollama serve` for better throughput on Apple Silicon or CUDA:

```bash
# persistent (macOS — survives reboots)
launchctl setenv OLLAMA_CONTEXT_LENGTH 32768
launchctl setenv OLLAMA_FLASH_ATTENTION 1
launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0

# or inline
OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve
```

| Variable                 | Purpose                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `OLLAMA_CONTEXT_LENGTH`  | Default context window (overridden by `numCtx` in `.wikirc.yaml`)            |
| `OLLAMA_FLASH_ATTENTION` | Enables Flash Attention for faster inference and lower VRAM usage            |
| `OLLAMA_KV_CACHE_TYPE`   | KV cache quantization — `q8_0` halves cache memory with minimal quality loss |

If Ollama runs outside the local process (Docker, remote server), set `flashAttention` and `kvCacheType` in `.wikirc.yaml` so `wiki doctor` can base its recommendations on the server configuration.

## `limits`

These keys describe operational and prompt budgets used by `wiki build --plan`, `wiki build`, `wiki ingest`, `wiki refresh`, and `wiki doctor`.

| Key                        | Description                                                                                 | Default |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| `requestsPerMinute`        | Effective LLM request throttle. Request starts are spaced at `60s / requestsPerMinute`      | `10`    |
| `maxInFlightRequests`      | Maximum concurrent in-job provider calls for section/batch generation                       | `3`     |
| `dailyInputTokens`         | Optional daily input-token budget, printed by `wiki build --plan` when set                  | —       |
| `targetInputTokensPerCall` | Preferred input-token budget per build call. The builder starts a new batch above this size | `40000` |
| `maxInputTokensPerCall`    | Hard input-token budget per build call. The builder trims retrieved context above this size | `50000` |
| `maxProfileChars`          | Maximum workspace profile characters loaded into prompts before summary fallback            | `4000`  |

`targetInputTokensPerCall` must be less than or equal to `maxInputTokensPerCall`.
`maxInFlightRequests` is capped at `16`; `slotBatchSize` is capped separately
at `50`.

`requestsPerMinute` limits the start rate of LLM provider calls across `ingest`,
`build`, and `refresh`. Embeddings and rerank inherit this value unless
`retrieval.vector.requestsPerMinute` is set. Processes in the same workspace
share each provider budget through `.wiki/rate-limit/`; `maxInFlightRequests`
only controls how many calls a single job may keep in flight while the shared
throttle decides when each request is allowed to start.

## `build`

| Key                    | Description                                                                                                        | Default |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| `refreshOnIngest`      | Automatically regenerate stale deliverables after each ingest                                                      | `true`  |
| `slotBatchSize`        | Optional maximum number of `[[INSTRUCTION:...]]` slots allowed in one build call; token budget plans batches first | —       |
| `maxBuildContextChars` | Maximum characters from `build-context/` files included in each build LLM call                                     | `24000` |

## `retrieval`

| Key                | Description                                              | Default |
| ------------------ | -------------------------------------------------------- | ------- |
| `maxContextFiles`  | Maximum wiki pages retrieved per slot for each LLM call  | `5`     |
| `maxChunksPerPage` | Maximum matching chunks returned from the same wiki page | `2`     |
| `maxChunkChars`    | Maximum characters kept from a retrieved wiki chunk      | `3000`  |
| `maxSourceChars`   | Maximum characters read from a raw source during ingest  | `8000`  |
| `buildStrategy`    | Build-context retrieval strategy: `bm25` or `hybrid`     | `bm25`  |

Vector retrieval options are documented in [vector-search.md](./vector-search.md).

### `retrieval.vector`

| Key                         | Description                                                                                         | Default |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------- |
| `enabled`                   | Enable vector retrieval/index usage. Lexical BM25 fallback remains available.                       | `false` |
| `baseUrl`                   | OpenAI-compatible base URL for `/embeddings` and `/rerank`. Defaults to `llm.baseUrl`.              | `llm.baseUrl` |
| `apiKey`                    | API key for vector endpoints. Omit it to reuse `llm.apiKey`.                                      | `llm.apiKey` |
| `requestsPerMinute`         | Separate RPM budget for embeddings/rerank. Defaults to `limits.requestsPerMinute`.                  | LLM RPM |
| `timeoutMs`                 | Vector endpoint timeout in milliseconds. Defaults to `llm.timeoutMs` or `600000`.                  | `600000` |
| `embeddingModel`            | Model sent to `/embeddings`.                                                                       | `BAAI/bge-m3` |
| `rerankEnabled`             | Enable `/rerank` after vector search for chat/MCP/search style queries.                            | `true` |
| `rerankerModel`             | Model sent to `/rerank`; kept explicit in scaffold because quality/cost tradeoff is user-visible.  | `BAAI/bge-reranker-v2-m3` |
| `topK`                      | Vector candidates retrieved before reranking. Valid range: `1` to `200`.                           | `48` |
| `rerankTopK`                | Candidates sent to reranker. Valid range: `1` to `100`.                                            | `24` |
| `maxResults`                | Final results returned to retrieval consumers. Valid range: `1` to `24`.                           | `6` |

Vector API key resolution is direct: `retrieval.vector.apiKey` is used when set;
otherwise vector calls reuse the resolved `llm.apiKey`.

> **Context budget** — `wiki build` now plans batches using the same logic as `wiki build --plan`: it groups slots up to `limits.targetInputTokensPerCall`, uses `build.slotBatchSize` only as an optional compatibility ceiling, and trims retrieved context if a batch exceeds `limits.maxInputTokensPerCall`. Build context uses BM25 lexical retrieval by default; set `retrieval.buildStrategy: hybrid` to re-enable vector/rerank for build on a quota-free provider. Run `wiki doctor` and `wiki build --plan` after changing these values.

## `mcp`

| Key            | Description                                                | Default |
| -------------- | ---------------------------------------------------------- | ------- |
| `accessKey`    | Bearer token required by MCP clients (stdio and HTTP)      | —       |
| `readToken`    | HTTP MCP bearer token limited to read/search tools         | —       |
| `writeToken`   | HTTP MCP bearer token for read and write tools             | —       |
| `tls.certPath` | Path to TLS certificate (enables HTTPS on `wiki mcp-http`) | —       |
| `tls.keyPath`  | Path to TLS private key                                    | —       |
| `tls.caPath`   | Path to CA certificate (optional, for mutual TLS)          | —       |

Env var equivalents: `WIKI_MCP_ACCESS_KEY` or legacy
`WIKI_MCP_AUTH_TOKEN`, `WIKI_MCP_READ_TOKEN`, `WIKI_MCP_WRITE_TOKEN`,
`WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`, `WIKI_MCP_TLS_CA_PATH`.

`WIKI_MCP_ACCESS_KEY` / `mcp.accessKey` is a full-access token. Prefer separate
read/write tokens for shared HTTP deployments. Rate limiting is controlled by
`WIKI_MCP_RATE_LIMIT_REQUESTS` and `WIKI_MCP_RATE_LIMIT_WINDOW_MS`.

## `serve`

`serve` currently has no YAML keys. HTTPS for `wiki serve` is configured through
environment variables only:

| Env var                    | Description                          |
| -------------------------- | ------------------------------------ |
| `WIKI_SERVE_TLS_CERT_PATH` | TLS certificate path for `wiki serve` |
| `WIKI_SERVE_TLS_KEY_PATH`  | TLS private key path                  |
| `WIKI_SERVE_TLS_CA_PATH`   | Optional CA path                      |
