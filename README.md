# llm-wiki

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](https://polyformproject.org/licenses/noncommercial/1.0.0/)

Open-source implementation of [Karpathy&#39;s LLM Wiki](https://x.com/karpathy/status/2039805659525644595) ([spec](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)).

---

`llm-wiki` is a command-line tool that turns raw project material into a durable, searchable, and reusable Markdown knowledge base. It helps you progressively build a local wiki from notes, meeting minutes, project documents, or Markdown exports, then use that wiki as context for generating reproducible deliverables.

The program works as a local documentation pipeline: sources are placed in an input folder, analyzed with the help of an LLM, and integrated into structured wiki pages. Those pages become the persistent memory of the project. From Markdown templates containing instructions, `llm-wiki` can then create or refresh derived documents in `deliverables/` by retrieving the relevant context from the wiki.

The goal is to keep the knowledge base readable, versionable, and easy to control: there is no vector database or opaque storage layer, and everything stays on disk as Markdown files (or by using MCP connexions). The tool can run with OpenAI, Ollama, Anthropic, or any OpenAI-compatible server (MLX), which makes it suitable for both cloud-based and fully local workflows.

`llm-wiki` also fits agent-assisted workflows. When Claude is connected to the workspace through MCP-capable tools, it can read source material, update pages under `wiki/`, maintain cross-references, and add footnote-style citations while keeping the knowledge base in plain Markdown.

`llm-wiki` is a local-first TypeScript CLI for maintaining a persistent markdown wiki from raw sources, then generating reproducible markdown deliverables from templates with `[[INSTRUCTION: ...]]` slots.

The workflow is inspired by Karpathy's LLM Wiki pattern:

1. drop markdown sources into `raw/untracked/`
2. ingest them into `wiki/`
3. query the persistent wiki
4. build or refresh derived documents in `deliverables/`

No vector database is used. Everything stays in markdown and on disk.

```
┌──────────────────────────────────────┐  ┌─────────────────────────────────────┐
│  raw sources                         │  │  AI assistant                       │
│  notes, exports, Confluence, PDFs    │  │  Claude Desktop / Claude Code       │
│  → raw/untracked/                    │  │                                     │
└──────────────┬───────────────────────┘  │  wiki mcp  (stdio)                  │
               │  wiki ingest  (LLM)      │  list_wiki_pages · read_wiki_page   │
               ▼                          │  write_wiki_page                    │
┌──────────────────────────────────────┐  │  list_sources · read_source         │
│  wiki/                        ◄──────┼──┤                                     │
│  ├── index.md                        │  └─────────────────────────────────────┘
│  ├── concepts/                       │
│  ├── sources/  (raw/ingested/)       │
│  └── answers/                        │
└──────┬────────────────┬──────────────┘
       │  wiki query    │  wiki build / refresh  (LLM)
       │  (LLM)         │
       ▼                ▼
┌────────────┐  ┌───────────────────────────────────────┐
│  answers   │  │  prompt context                       │
│  on stdout │  │  ├── retrieved wiki chunks            │
│  or saved  │  │  ├── templates/  [[INSTRUCTION: ...]] │
└────────────┘  │  └── build-context/  (fixed context)  │
                └──────────────────────┬────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  deliverables/  │
                              └────────┬────────┘
                                       │  wiki export  (LLM)
                                       ▼
                              ┌─────────────────┐
                              │  *.export.md    │
                              │  self-contained │
                              └─────────────────┘
```

## Quick Start

1. **Export your source documents** as Markdown (see [Importing sources](#importing-sources)) and copy them into `raw/untracked/`.

2. **Initialize a workspace** in an empty directory:

   ```bash
   wiki init
   ```

   Edit `.wikirc.yaml` to set your LLM provider, model, and `language`.

3. **Run the doctor** to validate your configuration and get tuning suggestions:

   ```bash
   wiki doctor
   ```

   Adjust `.wikirc.yaml` until the doctor reports no warnings, then rerun.

4. **Ingest sources** — the LLM reads each source file and updates `wiki/`:

   ```bash
   wiki ingest
   ```

5. **Build deliverables** from templates in `templates/`:

   ```bash
   wiki build
   ```

6. **Export a self-contained document** from a generated deliverable:

   ```bash
   wiki export deliverables/project-brief.md
   wiki export deliverables/project-brief.md --polish
   ```

Repeat steps 1 and 4 as new sources arrive. Run `wiki refresh` to rebuild stale deliverables without re-ingesting.

---

## Features

- Node.js 22 CLI with TypeScript and `commander`
- `.wikirc.yaml` config validated by `zod`
- supports `openai`, `ollama`, `anthropic`, and any OpenAI-compatible endpoint
- structured JSON mode enforced automatically for Ollama and OpenAI providers
- local-first workspace structure:
  - `raw/untracked`
  - `raw/ingested`
  - `wiki`
  - `templates`
  - `build-context`
  - `deliverables`
- reproducible deliverable generation with state tracked in `.wiki/build-state.json`
- automatic `refresh` after `ingest` by default
- static linting plus optional semantic linting through the configured LLM
- query answers optionally saved to `wiki/answers/` with `--save`
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

## Docker

A `Dockerfile` and `docker-compose.yml` are included. The image builds the TypeScript CLI into `dist/` and installs production dependencies in the runtime layer. This is required by runtime-loaded packages such as the local D3 bundle used by `wiki serve`.

```bash
docker compose build
```

### Running commands

Use the `wiki` service for one-shot CLI commands. It does not start the web server.

```bash
docker compose --profile cli run --rm wiki init
docker compose --profile cli run --rm wiki ingest
docker compose --profile cli run --rm wiki build
docker compose --profile cli run --rm wiki doctor
docker compose --profile cli run --rm wiki query "your question here"
```

### Browsing the wiki

Use the `serve` service for a persistent web UI.

```bash
docker compose up serve
# → http://localhost:3000
```

`EXPOSE 3000` in the Dockerfile does not start a server by itself. It only documents the port used when the command is `serve`. Running `docker compose --profile cli run --rm wiki ingest` while `docker compose up serve` is active is supported: both containers mount the same workspace, and the browser sees updated markdown after refresh.

### Selecting the workspace

By default the current directory is mounted into `/workspace` inside the container. Override with `WIKI_WORKSPACE`:

```bash
WIKI_WORKSPACE=/path/to/my/workspace docker compose --profile cli run --rm wiki ingest
WIKI_WORKSPACE=/path/to/my/workspace docker compose up serve
```

### Ollama

**macOS** — run Ollama natively on the host and point `.wikirc.yaml` at the Docker-internal hostname:

```yaml
llm:
  provider: ollama
  baseUrl: http://host.docker.internal:11434/v1
```

**Linux + NVIDIA GPU** — start the bundled Ollama container and point at the service name:

```bash
docker compose --profile gpu up ollama
```

```yaml
llm:
  provider: ollama
  baseUrl: http://ollama:11434/v1
```

### MLX

On Apple Silicon, run an OpenAI-compatible MLX server locally and point `.wikirc.yaml` at it.
For ingest/build workloads under roughly 11 GB, `mlx-community/Qwen2.5-7B-Instruct-4bit`
is a good default because it is compact and follows structured instructions reliably.

```bash
mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080 --max-tokens 4096
```

```yaml
llm:
  provider: openai-compatible
  model: mlx-community/Qwen2.5-7B-Instruct-4bit
  baseUrl: http://127.0.0.1:8080/v1
  temperature: 0.1
  timeoutMs: 600000
  numCtx: 16384

build:
  slotBatchSize: 1

retrieval:
  maxContextFiles: 4
  maxChunkChars: 2500
  maxSourceChars: 8000
```

Start with `numCtx: 8192` or `16384` for local MLX. Larger context windows can exceed memory
once the KV cache is included, even when the 4-bit model weights fit comfortably on disk.

### API keys

Pass OpenAI or Anthropic keys as environment variables — the compose file forwards them automatically:

```bash
OPENAI_API_KEY=sk-... docker compose run --rm wiki build
ANTHROPIC_API_KEY=sk-ant-... docker compose run --rm wiki build
```

## Configuration

The CLI looks for `.wikirc.yaml` or `.wikirc.yml` in the current directory or its parents.

### Top-level options

| Key          | Description                                                                                      | Default |
| ------------ | ------------------------------------------------------------------------------------------------ | ------- |
| `language` | Language for all LLM-generated content (wiki pages, deliverables, query answers). Overrides the language of source documents and user input. Use a natural-language name such as `french`, `english`, or `español`. | `fr` |

Example (Ollama with a 32k context window):

```yaml
language: fr

llm:
  provider: ollama
  model: YOUR_MODEL_NAME
  baseUrl: http://127.0.0.1:11434/v1
  temperature: 0.1
  timeoutMs: 600000
  numCtx: 32768

build:
  refreshOnIngest: false
  slotBatchSize: 3
  maxBuildContextChars: 12000

retrieval:
  maxContextFiles: 5
  maxChunksPerPage: 2
  maxChunkChars: 3000
  maxSourceChars: 8000
```

### `llm` options

| Key                | Description                                                                               | Default            |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------ |
| `provider`       | `openai`, `ollama`, `anthropic`, `openai-compatible`                              | `openai`         |
| `model`          | Model name passed to the provider                                                         | `gpt-5-mini`     |
| `apiKey`         | API key — falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars              | —                 |
| `baseUrl`        | Provider base URL                                                                         | provider-dependent |
| `temperature`    | Sampling temperature (0–2)                                                               | `0.1`            |
| `timeoutMs`      | Request timeout in milliseconds                                                           | `600000`         |
| `numCtx`         | Ollama context window size in tokens — set this explicitly to avoid the provider default | —                 |
| `flashAttention` | Ollama tuning hint for remote/containerized servers when env vars cannot be detected      | —                 |
| `kvCacheType`    | Ollama KV cache type hint:`f16`, `q8_0`, or `q4_0`                                  | —                 |

### `build` options

| Key                      | Description                                                                           | Default   |
| ------------------------ | ------------------------------------------------------------------------------------- | --------- |
| `refreshOnIngest`      | Automatically regenerate stale deliverables after each ingest                         | `true`  |
| `slotBatchSize`        | Number of `[[INSTRUCTION:...]]` slots sent to the model in a single call            | `3`     |
| `maxBuildContextChars` | Maximum characters from fixed `build-context/` files included in each build LLM call | `12000` |

### `retrieval` options

| Key                  | Description                                                      | Default  |
| -------------------- | ---------------------------------------------------------------- | -------- |
| `maxContextFiles`  | Maximum wiki pages retrieved**per slot** for each LLM call | `5`    |
| `maxChunksPerPage` | Maximum matching chunks returned from the same wiki page         | `2`    |
| `maxChunkChars`    | Maximum characters kept from a retrieved wiki chunk              | `3000` |
| `maxSourceChars`   | Maximum characters read from a pending raw source during ingest  | `8000` |

> **Context budget note** — each LLM call includes up to `slotBatchSize × maxContextFiles × maxChunkChars` characters plus fixed prompt overhead. Run `wiki doctor` after changing these values; it checks whether the combined prompt fits the effective context window.

### Supported providers

OpenAI:

`gpt-5-mini` is the recommended low-cost OpenAI default for ingest/build workloads.

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: YOUR_API_KEY_HERE
  baseUrl: https://api.openai.com/v1
  timeoutMs: 600000
```

Anthropic:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  apiKey: YOUR_API_KEY_HERE
  baseUrl: https://api.anthropic.com/v1
  timeoutMs: 600000
```

Ollama local:

```yaml
llm:
  provider: ollama
  model: qwen2.5:14b
  baseUrl: http://127.0.0.1:11434/v1
  timeoutMs: 1800000
  numCtx: 16384
  flashAttention: true
  kvCacheType: q8_0
```

> Set `numCtx` explicitly — without it Ollama may default to 2048 or 4096 regardless of your model's capabilities.

#### Ollama performance tuning

For better throughput on Apple Silicon or CUDA GPUs, set these environment variables before starting `ollama serve`:

```bash
# persistent (macOS launchd — survives reboots)
launchctl setenv OLLAMA_CONTEXT_LENGTH 16384
launchctl setenv OLLAMA_FLASH_ATTENTION 1
launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0

# or inline for a single session
OLLAMA_CONTEXT_LENGTH=16384 \
OLLAMA_FLASH_ATTENTION=1 \
OLLAMA_KV_CACHE_TYPE=q8_0 \
ollama serve
```

| Variable                   | Purpose                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `OLLAMA_CONTEXT_LENGTH`  | Default context window for all models (overridden by `numCtx` in `.wikirc.yaml`) |
| `OLLAMA_FLASH_ATTENTION` | Enables Flash Attention for faster inference and lower VRAM usage                    |
| `OLLAMA_KV_CACHE_TYPE`   | KV cache quantization —`q8_0` halves cache memory with minimal quality loss       |

If Ollama runs outside the local process namespace, for example in Docker or on another machine, `wiki doctor` cannot inspect `OLLAMA_*` from the server process. Set `flashAttention` and `kvCacheType` in `.wikirc.yaml` so the doctor can base memory and speed recommendations on the server configuration:

```yaml
llm:
  provider: ollama
  baseUrl: http://gpu-server:11434/v1
  numCtx: 32768
  flashAttention: true
  kvCacheType: q8_0
```

Generic OpenAI-compatible endpoint:

```yaml
llm:
  provider: openai-compatible
  model: my-model
  apiKey: optional-or-required-by-provider
  baseUrl: https://my-endpoint.example/v1
  timeoutMs: 600000
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
├── build-context/
│   └── deliverable-rules.md
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
wiki ingest --verbose
wiki ingest --debug
wiki ingest --trace-file .wiki/logs/ingest-manual.log
```

By default, `wiki ingest` also runs `wiki refresh` so stale deliverables get regenerated when the wiki changes. If that follow-up build fails because the provider is slow, unavailable, or out of credits, the wiki updates remain applied and the CLI tells you to rerun `wiki refresh` later.

Tracing options:

- `--verbose`: prints step-by-step ingestion traces in the terminal
- `--debug`: prints more detailed traces, including selected context pages and normalized operations
- `--trace-file <path>`: writes traces to a specific file relative to the workspace root

Every ingestion run also writes a persistent trace file under `.wiki/logs/`, for example:

```text
.wiki/logs/ingest-2026-04-17T11-37-24-123Z-mabc12.log
```

### `wiki query <question...>`

Answers a question from the persistent wiki and ingested source notes. Prints the answer to stdout.

```bash
wiki query "Quels faits sont déjà documentés sur concernant mon dossier d'architecture fonctionnel?"
```

Use `--save` to also write the answer to `wiki/answers/<slug>.md` with a frontmatter containing the question and date:

```bash
wiki query --save "Quels besions sont déjà documentés pour ma matrice des flux ?"
# → prints the answer
# → Saved to wiki/answers/quels-faits-sont-deja-documentes.md
```

Asking the same question again with `--save` overwrites the previous answer file.

### `wiki build [templates...]`

Generates markdown deliverables from templates in `templates/`. Each `[[INSTRUCTION: ...]]` slot is replaced by a markdown fragment produced from the wiki context only.

```bash
wiki build
wiki build templates/project-brief.md
wiki build --force
```

Slots are processed in batches of `build.slotBatchSize` per LLM call. For each slot, up to `retrieval.maxContextFiles` wiki pages are retrieved by keyword matching and included as context.

### `wiki refresh [templates...]`

Rebuilds only stale deliverables by comparing the current wiki hash and template hash against `.wiki/build-state.json`.

```bash
wiki refresh
wiki refresh --force
```

### `wiki export <deliverable>`

Expands a generated deliverable into a self-contained markdown document by replacing source citation markers with inline detail from the cited files.

```bash
wiki export deliverables/briefs/project-brief.md
# -> deliverables/briefs/project-brief.export.md

wiki export deliverables/briefs/project-brief.md --output deliverables/briefs/project-brief-full.md
wiki export deliverables/briefs/project-brief.md --polish
wiki export deliverables/briefs/project-brief.export.md --polish
# -> deliverables/briefs/project-brief.export.polished.md
```

`export` reads every `[src: ...]` citation in the deliverable, loads each cited file from inside the workspace, caps each source at `retrieval.maxSourceChars`, and sends the deliverable plus those sources to the LLM with strict instructions to expand each section inline without inventing facts. The default output path inserts `.export` before the extension. If the sources do not contain enough detail for a section, the LLM is instructed to keep the original text and append an insufficient-source note.

Use `--polish` to run a second editorial pass after expansion. The polish pass improves clarity, flow, sentence variety, and readability while preserving the same facts, headings, markdown structure, and source-grounded constraints. It can also be run on an already exported document that no longer contains `[src: ...]` citations; when the input already ends in `.export.md`, the default output becomes `.export.polished.md`.

### `wiki lint`

Runs static checks:

- dead wiki links
- orphan wiki pages
- missing source citations
- stale deliverables
- unresolved `[[INSTRUCTION: ...]]` placeholders left in generated outputs

Optional semantic checks via the configured LLM:

```bash
wiki lint
wiki lint --with-llm
wiki lint --json
```

### `wiki serve`

Starts a local HTTP server to browse the wiki, deliverables, and templates in a browser. `/` renders `wiki/index.md` as the entry point with navigation tiles. `/graph` shows a D3 force graph of wiki/source relations; relation details open rendered markdown in a modal.

```bash
wiki serve
wiki serve --port 8080
```

With Docker, use the long-running `serve` service:

```bash
docker compose up serve
```

Keep using `docker compose --profile cli run --rm wiki ...` for one-shot commands such as `ingest`, `refresh`, and `doctor`.

### `wiki doctor`

Checks provider connectivity, effective context size, wiki chunk sizes, build batch size, and Ollama memory/speed settings. When suggestions are available, `doctor` prints the exact `.wikirc.yaml` keys to change.

```bash
wiki doctor
docker compose --profile cli run --rm wiki doctor
```

In an interactive terminal, `doctor` asks before applying suggestions:

```text
Apply these changes to /path/to/.wikirc.yaml? [y/N]
```

Only `y`, `yes`, `o`, or `oui` writes the file. In non-interactive runs, such as CI or redirected output, `doctor` never writes and only prints the suggestions.

### `wiki mcp`

Starts a stdio MCP server that exposes the wiki workspace to AI assistants such as Claude Desktop or Claude Code.

```bash
wiki mcp
```

The server must be launched from inside the workspace (or a subdirectory) so it can locate `.wikirc.yaml` the same way the other CLI commands do.

Exposed tools:

| Tool                | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `list_wiki_pages` | List all pages under `wiki/` with their type                  |
| `read_wiki_page`  | Read a page by its relative path (e.g.`wiki/concepts/foo.md`) |
| `write_wiki_page` | Write or update a page — restricted to `wiki/*` paths        |
| `list_sources`    | List ingested source documents in `raw/ingested/`             |
| `read_source`     | Read an ingested source by its relative path                    |
| `search_wiki_context` | Search wiki pages and ingested sources, returning relevant passages for the client to answer from |
| `read_many`       | Read several `wiki/` or `raw/ingested/` files in one call       |

Write operations go through the same path guards as `wiki ingest`: `resolveInside` rejects any `../../` traversal, and `applyWikiOperations` refuses paths that do not start with `wiki/`.

For question-answering clients, the intended flow is:

1. Call `search_wiki_context` with the user question.
2. Inspect the returned paths, scores, headings, excerpts, and `[src: ...]` citations.
3. Call `read_many` for the selected `wiki/` or `raw/ingested/` paths.
4. Let the MCP client produce the final answer itself from that context.

#### Access key

An optional access key can be required before the server accepts connections. Set it in `.wikirc.yaml`:

```yaml
mcp:
  accessKey: your-secret-key
```

Then pass the same value as an environment variable in your MCP client config (`WIKI_MCP_ACCESS_KEY`). If the key is configured but the env var is absent or does not match, the server exits immediately with an error.

For Docker-only deployments, the server key can also be configured with `WIKI_MCP_ACCESS_KEY` instead of editing `.wikirc.yaml`. `WIKI_MCP_KEY` is still accepted for older stdio client configs, but new configs should use `WIKI_MCP_ACCESS_KEY`.

### `wiki mcp-http`

Starts a Streamable HTTP MCP server. Use this instead of `wiki mcp` when the AI client cannot launch a local process — for example a remote Claude deployment, a Docker-hosted assistant, or any client that connects over HTTP rather than stdio.

```bash
wiki mcp-http
wiki mcp-http --host 0.0.0.0 --port 3333 --path /mcp
```

| Option     | Description                  | Default       |
| ---------- | ---------------------------- | ------------- |
| `--host`   | Address to bind              | `127.0.0.1`   |
| `--port`   | TCP port                     | `3333`        |
| `--path`   | HTTP endpoint path           | `/mcp`        |

The server exposes the same tools as `wiki mcp`. Authentication uses a Bearer token:

```
Authorization: Bearer <mcp.accessKey>
```

If `mcp.accessKey` is not set the endpoint accepts unauthenticated connections — only do this on a trusted network.

#### HTTPS / TLS

Pass certificate paths in `.wikirc.yaml` or as environment variables. Both `certPath` and `keyPath` must be provided together; `caPath` is optional for mutual TLS.

```yaml
mcp:
  accessKey: your-secret-key
  tls:
    certPath: /certs/fullchain.pem
    keyPath: /certs/privkey.pem
    caPath: /certs/ca.pem       # optional
```

Environment variable equivalents: `WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`, `WIKI_MCP_TLS_CA_PATH`.

Relative paths are resolved against the workspace root; absolute paths (e.g. Docker volume mounts) are used as-is.

#### Docker

```bash
docker compose --profile mcp-http up mcp-http
```

With TLS via environment variables:

```bash
WIKI_MCP_ACCESS_KEY=your-secret-key \
WIKI_MCP_TLS_CERT_PATH=/certs/fullchain.pem \
WIKI_MCP_TLS_KEY_PATH=/certs/privkey.pem \
WIKI_CERTS=/absolute/path/to/certs \
docker compose --profile mcp-http up mcp-http
```

---

## MCP integration

`wiki mcp` starts a stdio MCP server. Connect it to Claude Desktop or Claude Code so an AI assistant can read and update the wiki directly without leaving the conversation.

### Claude Code

Add the following to `.claude/settings.json` at the root of your wiki workspace:

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "wiki",
      "args": ["mcp"],
      "type": "stdio",
      "env": { "WIKI_MCP_ACCESS_KEY": "your-secret-key" }
    }
  }
}
```

Because Claude Code runs in the workspace directory, no `cwd` is needed — `.wikirc.yaml` is found automatically. Omit `env` if no `accessKey` is configured.

### Claude Desktop

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "/absolute/path/to/wiki",
      "args": ["mcp"],
      "type": "stdio",
      "cwd": "/absolute/path/to/your/wiki-workspace",
      "env": { "WIKI_MCP_ACCESS_KEY": "your-secret-key" }
    }
  }
}
```

`cwd` must point to the workspace that contains `.wikirc.yaml`. The `command` must be the absolute path to the `wiki` binary (use `which wiki` to find it, or point directly at `dist/bin/wiki.js`).

### Prerequisites

`wiki` must be available in the shell PATH used by the MCP host. The easiest way is to link the built binary globally:

```bash
cd /path/to/llm-wiki
pnpm build
pnpm link --global
```

Restart Claude Desktop (or reload Claude Code) after editing the config.

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

## Importing sources

`llm-wiki` ingests standard markdown files. Two tools make it easy to convert existing content into that format.

### Confluence Markdown Exporter

[confluence-markdown-exporter](https://github.com/bdmac/confluence-markdown-exporter) exports a Confluence space as a tree of markdown files ready to drop into `raw/untracked/`.

```bash
python3.11 -m venv .cme
source .cme/bin/activate
pip install --upgrade pip
pip install confluence-markdown-exporter

cme config          # set your Confluence URL and credentials
cme space https://your-confluence.example/display/YOURSPACE/
```

The exported `.md` files can then be placed in `raw/untracked/` and ingested with `wiki ingest`.

### Markitdown

[markitdown](https://github.com/microsoft/markitdown) converts Office documents, PDFs, HTML, and other formats to markdown.

```bash
pip install 'markitdown[all]'
markitdown document.docx > raw/untracked/document.md
```

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
- large wikis will eventually need more efficient indexing (please use doctor to set ingest and build features)

## License

This project is released under the **PolyForm Noncommercial License 1.0.0**.

You may copy, read, test, and modify this repository for personal, academic, research, hobby, or non-commercial experimentation purposes.

Any commercial use, corporate use, integration into a commercial product, resale, paid service provision, client use, SaaS use, internal enterprise use, or exploitation after modification is prohibited without prior written agreement from the author or rights holder.
