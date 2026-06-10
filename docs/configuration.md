# Configuration

The CLI looks for `.wikirc.yaml` or `.wikirc.yml` in the current directory or its parents.
Set `WIKI_CONFIG_PATH` to load a specific config file inside the workspace, for example
`WIKI_CONFIG_PATH=.wikirc.yaml.openai`.

## Full example

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
  dailyInputTokens: 1000000
  targetInputTokensPerCall: 40000
  maxInputTokensPerCall: 50000
  maxProfileChars: 4000

build:
  refreshOnIngest: true
  slotBatchSize: 3
  maxBuildContextChars: 12000

retrieval:
  maxContextFiles: 5
  maxChunksPerPage: 2
  maxChunkChars: 3000
  maxSourceChars: 8000
  vector:
    enabled: false
    baseUrl: http://127.0.0.1:7997/v1
    apiKey: optional-vector-key
    timeoutMs: 600000
    embeddingModel: BAAI/bge-m3
    rerankEnabled: true
    rerankerModel: BAAI/bge-reranker-v2-m3
    topK: 120
    rerankTopK: 80
    maxResults: 6
```

## Top-level

| Key        | Description                                                                                                                                                | Default |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `language` | Language for all LLM-generated content. Use a natural-language name such as `french`, `english`, or `español`. Overrides the language of source documents. | `fr`    |

## `llm`

| Key              | Description                                                                                                                                          | Default            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `provider`       | `openai`, `ollama`, `anthropic`, `openai-compatible`                                                                                                 | `openai`           |
| `model`          | Model name passed to the provider                                                                                                                    | `gpt-5-mini`       |
| `apiKey`         | API key for this workspace. Recommended for remote providers. Env vars remain available as standalone fallbacks.                                     | —                  |
| `baseUrl`        | Provider base URL                                                                                                                                    | provider-dependent |
| `temperature`    | Sampling temperature (0–2)                                                                                                                           | `0.1`              |
| `timeoutMs`      | Request timeout in milliseconds                                                                                                                      | `600000`           |
| `numCtx`         | Active context window of the LLM server, in tokens. Useful for Ollama and local/OpenAI-compatible servers so `wiki doctor` can tune context budgets. | —                  |
| `flashAttention` | Ollama hint for remote/containerized servers when env vars cannot be detected                                                                        | —                  |
| `kvCacheType`    | Ollama KV cache quantization: `f16`, `q8_0`, or `q4_0`                                                                                               | —                  |

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
| `dailyInputTokens`         | Optional daily input-token budget, printed by `wiki build --plan` when set                  | —       |
| `targetInputTokensPerCall` | Preferred input-token budget per build call. The builder starts a new batch above this size | `40000` |
| `maxInputTokensPerCall`    | Hard input-token budget per build call. The builder trims retrieved context above this size | `50000` |

`targetInputTokensPerCall` must be less than or equal to `maxInputTokensPerCall`.

`requestsPerMinute` limits the start rate of generation calls across `ingest`,
`build`, `refresh`, and JSON repair calls in the current process. With the
default `10`, calls start at least about 6 seconds apart. Long calls are not
penalized: if one request takes 30 seconds, the next request can start
immediately after it finishes because the interval has already elapsed.

## `build`

| Key                    | Description                                                                                                   | Default |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| `refreshOnIngest`      | Automatically regenerate stale deliverables after each ingest                                                 | `true`  |
| `slotBatchSize`        | Maximum number of `[[INSTRUCTION:...]]` slots allowed in one build call before prompt-budget planning applies | `3`     |
| `maxBuildContextChars` | Maximum characters from `build-context/` files included in each build LLM call                                | `12000` |

## `retrieval`

| Key                | Description                                              | Default |
| ------------------ | -------------------------------------------------------- | ------- |
| `maxContextFiles`  | Maximum wiki pages retrieved per slot for each LLM call  | `5`     |
| `maxChunksPerPage` | Maximum matching chunks returned from the same wiki page | `2`     |
| `maxChunkChars`    | Maximum characters kept from a retrieved wiki chunk      | `3000`  |
| `maxSourceChars`   | Maximum characters read from a raw source during ingest  | `8000`  |

Vector retrieval options are documented in [vector-search.md](./vector-search.md).

> **Context budget** — `wiki build` now plans batches using the same logic as `wiki build --plan`: it groups slots up to `build.slotBatchSize`, starts a new batch when `limits.targetInputTokensPerCall` would be exceeded, and trims retrieved context if a batch exceeds `limits.maxInputTokensPerCall`. Run `wiki doctor` and `wiki build --plan` after changing these values.

## `mcp`

| Key            | Description                                                | Default |
| -------------- | ---------------------------------------------------------- | ------- |
| `accessKey`    | Bearer token required by MCP clients (stdio and HTTP)      | —       |
| `tls.certPath` | Path to TLS certificate (enables HTTPS on `wiki mcp-http`) | —       |
| `tls.keyPath`  | Path to TLS private key                                    | —       |
| `tls.caPath`   | Path to CA certificate (optional, for mutual TLS)          | —       |

Env var equivalents: `WIKI_MCP_AUTH_TOKEN`, `WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`, `WIKI_MCP_TLS_CA_PATH`.
