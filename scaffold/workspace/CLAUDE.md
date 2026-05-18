# Workspace Notes

This workspace follows a local-first LLM Wiki pattern.

## Workflow

- Run `wiki ingest` to turn raw sources into persistent wiki pages.
- `wiki ingest` continues after per-source failures; check the final summary and trace log for failed sources.
- Use `wiki query` to ask questions grounded in the wiki.
- Use `wiki build` or `wiki refresh` to regenerate deliverables from templates.
- Use `wiki serve` to browse the wiki UI. `/` renders `wiki/index.md`; `/graph` shows source/wiki relations.
- Use `wiki doctor` after changing `.wikirc.yaml`, model, context size, retrieval limits, or Ollama settings.

## Workspace Layout

- `.wikirc.yaml`: local configuration.
- `raw/untracked/`: new source markdown waiting for ingest.
- `raw/ingested/`: archived source markdown already processed.
- `wiki/`: persistent knowledge base maintained by the CLI.
- `wiki/index.md`: entry point for the web UI and high-level navigation.
- `wiki/concepts/`: durable reusable knowledge extracted from sources.
- `wiki/sources/`: source notes that summarize individual ingested documents.
- `templates/`: markdown deliverable templates with `[[INSTRUCTION: ...]]` placeholders.
- `build-context/`: shared generation rules injected only during `wiki build` and `wiki refresh`.
- `deliverables/`: generated markdown outputs; these should stay reproducible.

## Content Rules

- Generated content must never invent facts that are not documented in the wiki.
- Prefer citing source-backed claims with `[src: ...]` when producing deliverables.
- Keep shared deliverable rules in `build-context/`; keep template-specific structure in `templates/`.
- Keep manual edits in `wiki/` factual and durable. Put temporary/new source material in `raw/untracked/` instead.
- Put reusable knowledge in `wiki/concepts/`; keep `wiki/sources/` focused on what each source document says.
- Deliverables are generated outputs. Prefer changing source wiki pages or templates, then rerun `wiki refresh`.

## Doctor And Config

`wiki doctor` checks provider connectivity, effective context size, wiki chunk sizes, vector retrieval, build batch planning, prompt limits, and Ollama memory/speed settings.

When suggestions are available, `doctor` prints the exact `.wikirc.yaml` keys to change. Use `wiki doctor --apply` to write the suggested values directly.

For OpenAI GPT-5 models, `temperature` may be omitted by the CLI because some models only accept the provider default.

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

limits:
  targetInputTokensPerCall: 40000
  maxInputTokensPerCall: 50000

retrieval:
  maxContextFiles: 5
  maxChunksPerPage: 2
  maxChunkChars: 3000
  maxSourceChars: 8000
  vector:
    baseUrl: http://host.docker.internal:7997/v1
    rerankEnabled: false
```

For remote or Dockerized Ollama, `doctor` cannot inspect the server process environment. Set `flashAttention` and `kvCacheType` explicitly in `.wikirc.yaml`.
