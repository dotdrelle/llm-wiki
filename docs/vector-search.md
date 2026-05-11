# Vector search

By default, `llm-wiki` prefers vector search to retrieve wiki context. It uses embeddings and an optional reranker for higher-quality retrieval, with automatic lexical fallback when the vector index is not available.

## How it works

1. `wiki index` chunks each wiki page by headings and embeds each chunk via a `/v1/embeddings` endpoint.
2. The index is stored locally in `.wiki/vector-index` (LanceDB format) — no external database.
3. At search time (`wiki query`, `wiki build`, `wiki ingest`, `wiki_search_context`), the query is embedded and the nearest chunks are retrieved, then optionally re-ranked by a `/v1/rerank` endpoint.
4. If the index is missing or the embedding call fails, the system silently falls back to lexical search.

## Requirements

An OpenAI-compatible `/v1/embeddings` endpoint is required. A `/v1/rerank` endpoint is optional but recommended.

Compatible servers:

| Server                                                  | Embeddings        | Reranker |
| ------------------------------------------------------- | ----------------- | -------- |
| [infinity-emb](https://github.com/michaelfeil/infinity) | ✓                 | ✓        |
| [Ollama](https://ollama.com)                            | ✓ (select models) | ✗        |
| OpenAI API                                              | ✓                 | ✗        |
| Any OpenAI-compatible server                            | ✓                 | depends  |

The embedding and reranker endpoints are called against `llm.baseUrl`. If your embedding server runs on a different URL, use `provider: openai-compatible` and set `baseUrl` accordingly.

## Configuration

```yaml
retrieval:
  vector:
    enabled: true
    embeddingModel: BAAI/bge-m3 # model served by your /v1/embeddings endpoint
    rerankerModel: BAAI/bge-reranker-v2-m3 # model served by your /v1/rerank endpoint
    topK: 120 # vector candidates retrieved before re-ranking
    rerankTopK: 80 # candidates sent to the reranker
    maxResults: 6 # final wiki pages returned to the LLM
```

| Key                     | Description                                        | Default                   |
| ----------------------- | -------------------------------------------------- | ------------------------- |
| `vector.enabled`        | Prefer vector retrieval when an index is available | `true`                    |
| `vector.embeddingModel` | Model name for `/v1/embeddings`                    | `BAAI/bge-m3`             |
| `vector.rerankerModel`  | Model name for `/v1/rerank`                        | `BAAI/bge-reranker-v2-m3` |
| `vector.topK`           | Vector candidates retrieved before re-ranking      | `120`                     |
| `vector.rerankTopK`     | Candidates sent to the reranker                    | `80`                      |
| `vector.maxResults`     | Maximum wiki pages returned after ranking          | `6`                       |

## Building the index

```bash
wiki index
# or in Docker:
docker compose --profile cli run --rm wiki index
```

Run this after the initial `wiki ingest` and whenever the wiki changes significantly. Unchanged chunks reuse their stored embeddings — only new or modified chunks are re-embedded.

`wiki doctor` reports the index state and tests the embedding and reranker endpoints when `vector.enabled` is `true`.

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
    embeddingModel: nomic-embed-text
    rerankerModel: BAAI/bge-reranker-v2-m3 # Ollama has no /rerank — this will be skipped gracefully
```

Ollama does not expose a `/v1/rerank` endpoint. When the reranker call fails, the system falls back to distance-based ranking from the vector search. Use an `infinity-emb` sidecar if you want reranking.

## Index location

The index is stored in `.wiki/vector-index/` inside the workspace. Add it to `.gitignore` — it is regenerable and can be large.

```
.wiki/
```

The `.gitignore` created by `wiki init` already excludes `.wiki/`.
