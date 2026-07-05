# Vector search

By default, vector search is disabled so a fresh workspace works without an embedding endpoint. Enable it when you have an OpenAI-compatible embeddings service. When enabled, `llm-wiki` uses embeddings and an optional reranker for higher-quality retrieval, with automatic lexical fallback when the vector index is not available.

## How it works

1. `wiki index` chunks each wiki page by headings and embeds each chunk via a `/v1/embeddings` endpoint.
2. The index is stored locally in `.wiki/vector-index` (LanceDB format) — no external database.
3. At search time (`wiki query`, `wiki ingest`, `wiki_search_context`), the query is embedded and the nearest chunks are retrieved, then optionally re-ranked by a `/v1/rerank` endpoint. `wiki build` uses BM25 lexical context by default because its queries are mostly keyword-like; set `retrieval.buildStrategy: hybrid` to opt back into vector/rerank for build context.
4. If the index is missing or the embedding call fails, the system falls back to lexical search and logs a `retrieval:vector-fallback` warning.

## Requirements

An OpenAI-compatible `/v1/embeddings` endpoint is required. A `/v1/rerank` endpoint is optional but recommended.

Compatible servers:

| Server                                                  | Embeddings        | Reranker |
| ------------------------------------------------------- | ----------------- | -------- |
| [infinity-emb](https://github.com/michaelfeil/infinity) | ✓                 | ✓        |
| [Ollama](https://ollama.com)                            | ✓ (select models) | ✗        |
| OpenAI API                                              | ✓                 | ✗        |
| Any OpenAI-compatible server                            | ✓                 | depends  |

By default, the embedding and reranker endpoints use `llm.baseUrl`, the same API key as the generation model, and `limits.requestsPerMinute`. If embeddings/reranking run on a separate service, set `retrieval.vector.baseUrl`, `retrieval.vector.apiKeyEnv` or `apiKey`, and optionally `retrieval.vector.requestsPerMinute` in the workspace `.wikirc.yaml`.

## Configuration

```yaml
retrieval:
  vector:
    enabled: true
    baseUrl: http://127.0.0.1:7997/v1 # optional; defaults to llm.baseUrl
    apiKeyEnv: VECTOR_API_KEY # recommended when the vector endpoint differs from llm.baseUrl
    requestsPerMinute: 1000 # optional; defaults to limits.requestsPerMinute
    timeoutMs: 600000
    embeddingModel: BAAI/bge-m3 # model served by your /v1/embeddings endpoint
    rerankEnabled: true # set false to skip /v1/rerank and keep vector distance ordering
    rerankerModel: BAAI/bge-reranker-v2-m3 # model served by your /v1/rerank endpoint
    topK: 48 # vector candidates retrieved before re-ranking
    rerankTopK: 24 # candidates sent to the reranker
    maxResults: 6 # final wiki pages returned to the LLM
```

| Key                     | Description                                        | Default                                                    |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `vector.enabled`        | Prefer vector retrieval when an index is available | `false`                                                    |
| `vector.baseUrl`        | Base URL for `/v1/embeddings` and `/v1/rerank`     | `llm.baseUrl`                                              |
| `vector.apiKey`         | API key for vector endpoints                       | `WIKI_VECTOR_API_KEY`, `ALBERT_API_KEY`, then `llm.apiKey` |
| `vector.apiKeyEnv`      | Environment variable containing the vector API key | —                                                          |
| `vector.requestsPerMinute` | Vector/rerank request throttle                  | `limits.requestsPerMinute`                                 |
| `vector.timeoutMs`      | Timeout for vector endpoint calls                  | `llm.timeoutMs` or `600000`                                |
| `vector.embeddingModel` | Model name for `/v1/embeddings`                    | `BAAI/bge-m3`                                              |
| `vector.rerankEnabled`  | Enable `/v1/rerank` after vector search            | `true`                                                     |
| `vector.rerankerModel`  | Model name for `/v1/rerank`                        | `BAAI/bge-reranker-v2-m3`                                  |
| `vector.topK`           | Vector candidates retrieved before re-ranking      | `48`                                                       |
| `vector.rerankTopK`     | Candidates sent to the reranker                    | `24`                                                       |
| `vector.maxResults`     | Maximum wiki pages returned after ranking          | `6`                                                        |

## Building the index

```bash
wiki index
# or in Docker:
docker compose --profile cli run --rm wiki index
```

Run this after the initial `wiki ingest` and whenever the wiki changes significantly. Unchanged chunks reuse their stored embeddings — only new or modified chunks are re-embedded.

`wiki doctor` reports the index state, batch profile (`16` chunks / `24,000` chars), fallback mode, and tests the embedding and reranker endpoints when `vector.enabled` is `true`.

The embedding build starts with a batch call, then recursively splits failed batches down to single chunks. Oversized single chunks are skipped with a warning and remain covered by lexical search.

Local embedding providers are supported today when they expose an OpenAI-compatible `/v1/embeddings` endpoint. A dedicated local-embeddings profile can be added later without changing the ingest or retrieval APIs.

## Ollama embeddings

Ollama supports embeddings for models like `nomic-embed-text` and `mxbai-embed-large`:

```bash
ollama pull nomic-embed-text
```

```yaml
llm:
  provider: ollama
  baseUrl: http://127.0.0.1:11434/v1

retrieval:
  vector:
    enabled: true
    baseUrl: http://127.0.0.1:11434/v1
    embeddingModel: nomic-embed-text
    rerankEnabled: false # Ollama has no /rerank
```

Ollama does not expose a `/v1/rerank` endpoint. Set `rerankEnabled: false` to keep distance-based ranking from the vector search. Use an `infinity-emb` sidecar if you want reranking.

## Index location

The index is stored in `.wiki/vector-index/` inside the workspace. Add it to `.gitignore` — it is regenerable and can be large.

```
.wiki/
```

The `.gitignore` created by `wiki init` already excludes `.wiki/`.
