# Commands

## `wiki init`

Scaffolds a new workspace in the current directory.

```bash
wiki init
wiki init --force
```

## `wiki ingest [files...]`

Reads markdown files from `raw/untracked/`, asks the LLM for wiki update operations, writes them into `wiki/`, then archives the raw files into `raw/ingested/`.

```bash
wiki ingest
wiki ingest raw/untracked/2026/04/16-notes.md
wiki ingest --dry-run
wiki ingest --no-refresh
wiki ingest --verbose
wiki ingest --debug
wiki ingest --trace-file .wiki/logs/ingest-manual.log
```

By default, `wiki ingest` also runs `wiki refresh` so stale deliverables get regenerated. If the follow-up build fails, the wiki updates remain applied and the CLI tells you to rerun `wiki refresh` later.

Tracing options:

- `--verbose` — prints step-by-step traces in the terminal
- `--debug` — prints detailed traces including selected context pages and normalized operations
- `--trace-file <path>` — writes traces to a specific file relative to the workspace root

Every ingestion run also writes a persistent trace under `.wiki/logs/`, e.g. `.wiki/logs/ingest-2026-04-17T11-37-24-123Z.log`.

## `wiki index`

Creates or updates the local vector index for `wiki/**/*.md` (excluding `wiki/answers/**`). The index is stored under `.wiki/vector-index`.

```bash
wiki index
docker compose --profile cli run --rm wiki index
```

Unchanged chunks reuse their stored embeddings. New, modified, or deleted chunks are reconciled on each run. See [vector-search.md](./vector-search.md) for setup and configuration.

## `wiki query <question...>`

Answers a question from the persistent wiki and prints the answer to stdout.

```bash
wiki query "What facts are already documented about the functional architecture?"
```

Use `--save` to write the answer to `wiki/answers/<slug>.md`:

```bash
wiki query --save "What needs are documented for the flow matrix?"
# → prints answer
# → Saved to wiki/answers/what-needs-are-documented.md
```

Asking the same question again with `--save` overwrites the previous answer file.

## `wiki build [templates...]`

Generates markdown deliverables from templates in `templates/`. Each `[[INSTRUCTION: ...]]` slot is replaced by a fragment produced from wiki context.

```bash
wiki build
wiki build templates/project-brief.md
wiki build --force
wiki build --plan
wiki build --verbose
wiki build --debug
```

`wiki build --plan` reads the same templates and wiki context as a real build, then prints the planned batches, context pages, estimated input tokens, and configured limits without calling the generation LLM.

Slots are grouped up to `build.slotBatchSize`, but the build planner can split earlier when `limits.targetInputTokensPerCall` would be exceeded. If a batch is still above `limits.maxInputTokensPerCall`, retrieved context is trimmed before the LLM call.

## `wiki refresh [templates...]`

Rebuilds only stale deliverables by comparing the current wiki and template hashes against `.wiki/build-state.json`.

```bash
wiki refresh
wiki refresh --force
wiki refresh templates/project-brief.md
```

## `wiki export <deliverable>`

Expands a generated deliverable into a self-contained markdown document by replacing `[src: ...]` citation markers with inline detail from the cited files.

```bash
wiki export deliverables/project-brief.md
# → deliverables/project-brief.export.md

wiki export deliverables/project-brief.md --output deliverables/project-brief-full.md
wiki export deliverables/project-brief.md --polish
# → deliverables/project-brief.export.md  (then)
# → deliverables/project-brief.export.polished.md  (with --polish on the .export)
```

The LLM expands each section from the cited sources without inventing facts. If sources lack detail for a section, it keeps the original text and appends an insufficient-source note.

`--polish` runs a second editorial pass that improves clarity, flow, and readability while preserving facts, headings, and structure. It can also be run on an already-exported document (`.export.md`).

## `wiki lint`

Runs static checks:

- dead wiki links
- orphan wiki pages
- missing source citations
- stale deliverables
- unresolved `[[INSTRUCTION: ...]]` placeholders left in outputs

```bash
wiki lint
wiki lint --with-llm   # adds semantic checks (contradictions, missing concepts, shallow pages)
wiki lint --json       # emit results as JSON
```

## `wiki serve`

Starts a local HTTP server to browse the wiki, deliverables, and templates in a browser.

- `/` — renders `wiki/index.md` with navigation tiles
- `/graph` — D3 force graph of wiki/source relations
- `/chat` — browser chat UI with OpenAI-compatible tool calling over MCP

```bash
wiki serve
wiki serve --port 8080
```

The chat UI can connect to one or more Streamable HTTP MCP servers. It exposes MCP
tools as OpenAI-compatible function tools, loops over tool results, and shows the
observable call chain as linked tiles. Tool details are collapsed by default; local
wiki paths returned by tools can be opened in a rendered Markdown modal.

When `wiki serve` runs in Docker or manager mode, `/api/chat` and `/api/mcp` act as
server-side proxies so the browser does not need direct access to internal Docker
hostnames or bearer tokens.

With Docker, use the long-running `serve` service instead:

```bash
docker compose up serve
# → http://localhost:3000
```

## `wiki doctor`

Checks provider connectivity, effective context size, chunk sizes, build batch size, Ollama memory/speed settings, and vector index state. Prints exact `.wikirc.yaml` keys to change when suggestions are available.

```bash
wiki doctor
wiki doctor --apply
docker compose --profile cli run --rm wiki doctor
```

By default, `doctor` prints suggested `.wikirc.yaml` changes only. Use `--apply` to write the suggested values directly.

## `wiki mcp`

Starts a stdio MCP server exposing the wiki to AI assistants. See [mcp.md](./mcp.md) for full setup.

## `wiki mcp-http`

Starts a Streamable HTTP MCP server. See [mcp.md](./mcp.md) for full setup.
