# llm-wiki

`llm-wiki` is a local-first TypeScript CLI for maintaining a persistent markdown wiki from raw sources, then generating reproducible markdown deliverables from templates with `[[INSTRUCTION: ...]]` slots.

The workflow is inspired by Karpathy's LLM Wiki pattern:

1. drop markdown sources into `raw/untracked/`
2. ingest them into `wiki/`
3. query the persistent wiki
4. build or refresh derived documents in `deliverables/`

No vector database is used. Everything stays in markdown and on disk.

## Features

- Node.js 22 CLI with TypeScript and `commander`
- `.wikirc.yaml` config validated by `zod`
- supports `openai`, `ollama`, and any OpenAI-compatible endpoint
- local-first workspace structure:
  - `raw/untracked`
  - `raw/ingested`
  - `wiki`
  - `templates`
  - `deliverables`
- reproducible deliverable generation with state tracked in `.wiki/build-state.json`
- automatic `refresh` after `ingest` by default
- static linting plus optional semantic linting through the configured LLM
- tests with `vitest`
- linting with `eslint`
- formatting with `prettier`

## Installation

Requires Node.js 22+.

```bash
corepack enable
pnpm install
pnpm build
```

Run locally during development:

```bash
pnpm dev init
pnpm dev ingest
pnpm dev build
```

## Configuration

The CLI looks for `.wikirc.yaml` or `.wikirc.yml` in the current directory or its parents.

Example:

```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: YOUR_API_KEY_HERE
  baseUrl: https://api.openai.com/v1
  temperature: 0.1

build:
  refreshOnIngest: true

retrieval:
  maxContextFiles: 8
```

### Supported providers

OpenAI:

```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: ${OPENAI_API_KEY}
  baseUrl: https://api.openai.com/v1
```

Ollama local:

```yaml
llm:
  provider: ollama
  model: qwen2.5:14b
  baseUrl: http://127.0.0.1:11434/v1
```

Generic OpenAI-compatible endpoint:

```yaml
llm:
  provider: openai-compatible
  model: my-model
  apiKey: optional-or-required-by-provider
  baseUrl: https://my-endpoint.example/v1
```

## Workspace layout

After `wiki init`:

```text
.
├── .wikirc.yaml
├── CLAUDE.md
├── raw/
│   ├── untracked/
│   └── ingested/
├── wiki/
│   ├── index.md
│   ├── log.md
│   ├── concepts/
│   ├── sources/
│   └── answers/
├── templates/
│   └── project-brief.md
└── deliverables/
```

Internal build metadata is stored in `.wiki/build-state.json` and ignored by Git.

## Commands

### `wiki init`

Scaffolds a new workspace in the current directory.

```bash
wiki init
wiki init --force
```

### `wiki ingest [files...]`

Reads markdown files from `raw/untracked/`, asks the configured model for wiki update operations, writes them into `wiki/`, then archives the raw files into `raw/ingested/`.

```bash
wiki ingest
wiki ingest raw/untracked/2026/04/16-notes.md
wiki ingest --dry-run
wiki ingest --no-refresh
```

By default, `wiki ingest` also runs `wiki refresh` so stale deliverables get regenerated when the wiki changes.

### `wiki query <question...>`

Answers a question from the persistent wiki and ingested source notes.

```bash
wiki query "Quels faits sont déjà documentés sur l’adoption IA ?"
```

### `wiki build [templates...]`

Generates markdown deliverables from templates in `templates/`. Each `[[INSTRUCTION: ...]]` slot is replaced by a markdown fragment produced from the wiki context only.

```bash
wiki build
wiki build templates/project-brief.md
wiki build --force
```

### `wiki refresh [templates...]`

Rebuilds only stale deliverables by comparing the current wiki hash and template hash against `.wiki/build-state.json`.

```bash
wiki refresh
wiki refresh --force
```

### `wiki lint`

Runs static checks:

- dead wiki links
- orphan wiki pages
- missing source citations
- stale deliverables
- unresolved `[[INSTRUCTION: ...]]` placeholders left in generated outputs

Optional semantic checks:

```bash
wiki lint
wiki lint --with-llm
wiki lint --json
```

## Deliverable templates

Templates are standard markdown files with optional frontmatter.

Recognized frontmatter keys:

- `title`: kept in the generated markdown frontmatter
- `output`: relative path under `deliverables/`
- `description`: template-only metadata, stripped from output

Example:

```md
---
title: Project Brief
output: briefs/project-brief.md
---

# Project Brief

## Executive Summary
[[INSTRUCTION: Produce a concise executive summary using only facts documented in the wiki. Cite claims with [src: ...].]]
```

Rules enforced by prompts:

- use only information present in the wiki context
- cite factual claims
- if the wiki is missing evidence, say so explicitly
- do not fill gaps with speculation

## Development

Scripts:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format
```

## Tests

The baseline Vitest suite covers:

- config resolution and validation
- parsing of `[[INSTRUCTION: ...]]`
- safe rejection of writes outside `wiki/`
- deliverable generation and build state updates

## Examples

See [`examples/README.md`](./examples/README.md), [`examples/raw/ai-adoption-notes.md`](./examples/raw/ai-adoption-notes.md), and [`examples/templates/decision-note.md`](./examples/templates/decision-note.md).

## Limitations

- retrieval is lexical only
- no embeddings or vector database
- model outputs are validated structurally, but not semantically guaranteed
- large wikis will eventually need more efficient indexing
