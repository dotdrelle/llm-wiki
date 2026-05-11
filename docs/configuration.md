# Configuration

The CLI looks for `.wikirc.yaml` or `.wikirc.yml` in the current directory or its parents.

## Full example

```yaml
language: fr

llm:
  provider: ollama
  model: qwen2.5:14b
  baseUrl: http://127.0.0.1:11434/v1
  temperature: 0.1
  timeoutMs: 600000
  numCtx: 32768
  flashAttention: true
  kvCacheType: q8_0

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
    enabled: true
    embeddingModel: BAAI/bge-m3
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
| `apiKey`         | API key — falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars                                                                              | —                  |
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

## `build`

| Key                    | Description                                                                    | Default |
| ---------------------- | ------------------------------------------------------------------------------ | ------- |
| `refreshOnIngest`      | Automatically regenerate stale deliverables after each ingest                  | `true`  |
| `slotBatchSize`        | Number of `[[INSTRUCTION:...]]` slots sent to the model in a single call       | `3`     |
| `maxBuildContextChars` | Maximum characters from `build-context/` files included in each build LLM call | `12000` |

## `retrieval`

| Key                | Description                                              | Default |
| ------------------ | -------------------------------------------------------- | ------- |
| `maxContextFiles`  | Maximum wiki pages retrieved per slot for each LLM call  | `5`     |
| `maxChunksPerPage` | Maximum matching chunks returned from the same wiki page | `2`     |
| `maxChunkChars`    | Maximum characters kept from a retrieved wiki chunk      | `3000`  |
| `maxSourceChars`   | Maximum characters read from a raw source during ingest  | `8000`  |

Vector retrieval options are documented in [vector-search.md](./vector-search.md).

> **Context budget** — each LLM call includes up to `slotBatchSize × maxContextFiles × maxChunkChars` characters plus fixed prompt overhead. Run `wiki doctor` after changing these values.

## `mcp`

| Key            | Description                                                | Default |
| -------------- | ---------------------------------------------------------- | ------- |
| `accessKey`    | Bearer token required by MCP clients (stdio and HTTP)      | —       |
| `tls.certPath` | Path to TLS certificate (enables HTTPS on `wiki mcp-http`) | —       |
| `tls.keyPath`  | Path to TLS private key                                    | —       |
| `tls.caPath`   | Path to CA certificate (optional, for mutual TLS)          | —       |

Env var equivalents: `WIKI_MCP_ACCESS_KEY`, `WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`, `WIKI_MCP_TLS_CA_PATH`.
