# Doctor audit 0.11.3

This audit captures what `src/commands/doctor.ts` detects before the qualitative
doctor extension. It is intentionally factual: each row states the current signal,
the failure it catches, the likely false negatives/positives, and the decision for
0.11.3.

## Inventory

| Area | Current check | Catches | False negatives | False positives | Verdict |
| --- | --- | --- | --- | --- | --- |
| Config display | Prints effective runtime values from `AppConfig`. | Obvious wrong values visible to a human. | No provenance, no schema/default/preset/file attribution. | None, informational only. | Correct: add provenance from `loadConfigDetails`. |
| Non-Ollama provider | `GET <baseUrl>/models`, accepts HTTP 2xx and HTTP 400 as reachable/key accepted. | Dead `baseUrl`, invalid key on 401/403. | Model missing when `/models` returns a list; 400 can hide a broken models endpoint; no latency/TTFT/tokens/s; no quota diagnosis. | Providers without `/models` may warn even if completions work. | Replace with measured completion probe; keep `/models` as cheap preflight only. |
| Ollama provider | `GET /api/tags`, checks configured model name, then `POST /api/show`. | Ollama down, model not pulled, missing model details. | Remote Ollama runtime env unknown unless `.wikirc` declares it. | Prefix match can accept a related model tag. | Keep, tighten matching only if users hit ambiguity. |
| Ollama hardware | Estimates model VRAM and KV cache from `/api/show`, system RAM, `numCtx`, flash attention, KV cache type. | Oversized local context, missing FlashAttention, expensive `f16` KV. | GPU/Metal availability and real server limits are inferred, not measured. | RAM heuristic may warn on machines with enough unified memory. | Keep, document heuristic nature. |
| MLX heuristic | Detects local OpenAI-compatible URL/model name and recommends lower context/retrieval limits. | Common local MLX overload configs. | Any remote proxy on localhost-like URL; non-MLX local servers. | Can over-restrict stable local servers. | Keep but classify as advisory. |
| Wiki content | Counts pages, chunks, `index.md`, build-context, raw/untracked files. | Missing `wiki/index.md`, oversized pending files, oversized chunks. | Does not detect stale generated pages, broken links, or source freshness. | Large files may be intentionally split safely. | Keep, extend later with freshness checks. |
| Vector index | Reads LanceDB stats and metadata. | Missing index, metadata missing, provider/model/dimension mismatch after embedding probe. | Does not compare page mtimes/hash freshness against index build time. | Metadata mismatch warning is correct but can be noisy after intentional config edits. | Correct: add freshness check. |
| Embedding endpoint | Sends one embedding request when vector is enabled. | Bad vector URL/key/model, malformed provider response. | Generic warning hides class: 401, 404 model, 429 quota, malformed JSON/vector. | A single text can pass while batch limits fail. | Replace with classified diagnostics and measured latency. |
| Rerank endpoint | Sends one rerank request when rerank is enabled. | Missing `/rerank`, bad reranker model/key. | Generic warning; no recommendation to disable rerank or switch build strategy. | Providers with alternate rerank schemas fail even if user does not need rerank. | Correct: classify and recommend with impact. |
| Build plan | Runs `BuildService.planBuild({ fastContext: true })`. | Planned batches over target/max token limits, daily token budget pressure. | No wall-clock estimate from measured provider latency; ingest/export not estimated. | Fast context approximation can differ from full retrieval. | Keep and feed measured latencies into estimates. |
| Recommended config | Computes a minimal patch for limits/build/retrieval and supports `--apply`. | Writes useful defaults and budget corrections. | Recommendations are generic and lack expected gain; patch can re-add verbose vector fields. | `slotBatchSize: 50` is now mostly a compatibility cap, not always useful. | Correct: recommendation must include estimated impact and preserve minimal config. |
| Global status | Prints `✓`, `⚠`, `✗` lines but returns `void`. | Human-readable state. | Automation cannot fail CI reliably; "zero false green" is not enforceable. | None. | Replace with accumulated status and tests. |

## Fault matrix baseline

| Fault | Current behavior | Gap for 0.11.3 |
| --- | --- | --- |
| Invalid API key | `✗ API key invalid or missing` for provider; vector errors are generic. | Keep provider error, classify vector 401 explicitly, global status must not be OK. |
| `baseUrl` unreachable | `✗ provider not reachable ...`. | Keep, add latency measurement only when reachable. |
| Missing LLM model | Non-Ollama provider can pass if `/models` is reachable. | Check model membership when `/models` returns a usable model list; completion probe later. |
| Missing `/rerank` | Generic `reranker check failed ... HTTP 404`. | Recommend `retrieval.vector.rerankEnabled: false` or provider endpoint fix; keep chat/MCP rerank decision visible. |
| Stale vector index | Only provider/model/dimension mismatch is detected. | Compare index build metadata with wiki page freshness. |
| Incoherent `numCtx` | Strong for Ollama/MLX, weak for remote providers. | Cross-check `numCtx`, token budgets, batches, and model context declaration. |
| RPM quota exhausted | HTTP 429 appears as a generic provider/vector warning. | Report quota state from shared token bucket plus provider headers and estimate wait. |
| Malformed embedding response | Generic embedding warning. | Classify as provider contract/schema failure. |

## Decisions

- Keep the current doctor as the shell of the command, but introduce an internal
  diagnostic accumulator so tests and CI can assert `ok`, `warning`, or `error`.
- Use the existing service probes for embedding/rerank, but normalize their errors
  into user-facing classes before printing recommendations.
- Add tests using a local/mock provider matrix. Every broken config in the matrix
  must produce the expected diagnostic and must not look globally OK.
- Do not make `--apply` rewrite a minimal `.wikirc.yaml` back into a verbose one.
