# Workspace Notes

This workspace follows a local-first LLM Wiki pattern.

## Workflow

- Run `wiki ingest` to turn raw sources into persistent wiki pages.
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
- `deliverables/`: generated markdown outputs; these should stay reproducible.

## Content Rules

- Generated content must never invent facts that are not documented in the wiki.
- Prefer citing source-backed claims with `[src: ...]` when producing deliverables.
- Keep manual edits in `wiki/` factual and durable. Put temporary/new source material in `raw/untracked/` instead.
- Put reusable knowledge in `wiki/concepts/`; keep `wiki/sources/` focused on what each source document says.
- Deliverables are generated outputs. Prefer changing source wiki pages or templates, then rerun `wiki refresh`.

## Doctor And Config

`wiki doctor` checks provider connectivity, effective context size, wiki chunk sizes, build batch size, and Ollama memory/speed settings.

When suggestions are available, `doctor` prints the exact `.wikirc.yaml` keys to change. In an interactive terminal it may ask:

```text
Apply these changes to /path/to/.wikirc.yaml? [y/N]
```

Only `y`, `yes`, `o`, or `oui` writes the file. Non-interactive runs only print suggestions.

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
```

For remote or Dockerized Ollama, `doctor` cannot inspect the server process environment. Set `flashAttention` and `kvCacheType` explicitly in `.wikirc.yaml`.
