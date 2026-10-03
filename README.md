# llm-wiki

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

`llm-wiki` is a local-first Markdown knowledge engine.

It turns raw project material into a persistent wiki, builds a local retrieval
index, and regenerates deliverables from templates. It works as a standalone CLI
or as the workspace engine used by `llm-wiki-manager`.

The core rule is simple: the workspace is the source of truth. Sources, wiki
pages, templates, build rules, generated deliverables, traces, and skill state
all live on disk.

Scope note: this is a single-user deployment baseline. Keep runtime write
access local or proxied rather than exposing it as a shared multi-user surface.

## Toolchain

| Repository                                                                    | Role                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`llm-wiki`](https://github.com/dotdrelle/llm-wiki)                           | Workspace engine: CLI, web UI, MCP server, retrieval, deliverables, skills |
| [`llm-wiki-manager`](https://github.com/dotdrelle/llm-wiki-manager)           | Multi-workspace cockpit, Docker orchestration, `dot` shell                 |
| [`agent-cme`](https://github.com/dotdrelle/agent-cme)                         | Workspace-scoped Confluence to Markdown exporter                           |
| [`agent-production`](https://github.com/dotdrelle/agent-production) | Workspace-scoped production jobs                                           |

## What It Does

```text
raw/untracked/
  -> wiki ingest
  -> wiki/
       index.md
       concepts/
       sources/
       answers/
  -> wiki index
  -> .wiki/vector-index/
  -> wiki build
  -> deliverables/
  -> wiki export
```

Main capabilities:

- initialize a workspace with `wiki init`;
- ingest Markdown sources from `raw/untracked/`;
- rebuild TAXO fiches and tag-family pivots from the archived sources
  (`wiki ingest --from-ingested`);
- maintain durable wiki pages under `wiki/`;
- query the wiki with lexical and optional vector retrieval;
- query and render the **knowledge graph** (citations, wiki links, shared
  subjects/tags) through the `wiki_graph_query`, `wiki_graph_view` and
  `wiki_graph_path` MCP tools;
- generate deliverables from `templates/` and `build-context/`;
- show a build runtime/provider summary and compare it with the previous build;
- export deliverables with inline source detail;
- serve a local web UI and MCP endpoint, including the agent-proposals review
  queue where curation diffs are merged or rejected.

## Ingestion contract — TAXO

Ingest is one deterministic cycle over the live corpus. For each archived
document the engine splits the meaningful `#` sections (an oversized section
splits at its `##` sub-headings), has the model rewrite each section
faithfully with a `Description:` and 2–3 `Tags:`, and writes one fiche under
`wiki/sources/<document>/<section>.md`. The engine — never the model — anchors
each fiche to the exact archived line range (`#L42-L57@sha256=…`), harmonizes
tag spelling against the fiches already on disk, and groups tags into semantic
families with one bounded call; generated pivots live under
`wiki/concepts/<family>/<tag>.md` and are navigation, not evidence.

The pipeline is idempotent: a per-section `input_hash` (source, line range,
prompt/model/language signature) skips an unchanged section, while a
`content_hash` catches exact duplicates across documents; a section judged
close to an existing fiche is skipped and logged with the fiche it matched.
Stable/verified pages are never rewritten or purged. There is no separate
analysis/apply mode and no ingest plan file: `--dry-run` reviews the
operations, `--reject <path…>` drops some, `--migrate-sheets [--apply]`
migrates a legacy workspace on a copy, and `--from-ingested` rebuilds from
`raw/ingested/`. See `help-doc/03` for the user view and `docs/provenance.md`
for the data contracts.


## Quick Start

```bash
wiki init
```

Edit `.wikirc.yaml` with your provider, model, endpoint, key, language, and
retrieval settings.

The generated `.wikirc.yaml` keeps provider keys directly in `llm.apiKey` and
`retrieval.vector.apiKey`; `apiKeyEnv` and `WIKI_LLM_API_KEY` /
`WIKI_VECTOR_API_KEY` are not part of the default config path.

Validate the workspace:

```bash
wiki doctor
```

Add Markdown source files:

```text
raw/untracked/my-source.md
```

Ingest them:

```bash
wiki ingest
```

Build deliverables:

```bash
wiki build
```

Generated slot replacements are normalized before they are written into the
template: escaped Markdown newlines such as `\n` are restored, a repeated slot
heading is removed when the template already provides it, and generated
subheadings are shifted below the template heading level.

Inspect planned LLM calls before building:

```bash
wiki build --plan
```

Export a generated deliverable:

```bash
wiki export note/basic-note.md --polish
```

## Workspace Layout

```text
.
├── .wikirc.yaml              # provider/model/retrieval config
├── CLAUDE.md                 # optional operator/agent instructions
├── .wiki/
│   ├── build-state.json
│   ├── logs/
│   ├── skills/              # slash/chat skills exposed by UI and shell
│   ├── system-prompt.md     # optional workspace LLM behavior prompt
│   ├── tmp/                 # backups and temporary install data
│   └── vector-index/        # LanceDB index created by `wiki index`
├── raw/
│   ├── untracked/           # new source material
│   └── ingested/            # archived source material after ingest
├── wiki/
│   ├── index.md
│   ├── log.md
│   ├── concepts/
│   ├── sources/
│   └── answers/
├── templates/
├── build-context/
├── deliverables/
└── docs/
```

## Workspace Skills

A workspace skill is a method for one workspace: templates, build rules,
chat/shell skills, a system prompt and operator instructions, laid out in the
workspace itself. The layout is the package entry point:

```text
templates/
build-context/
.wiki/skills/            # slash/chat skills, edited in place
.wiki/system-prompt.md   # optional
CLAUDE.md                # optional
```

The suite is one-skill-per-workspace: editing a skill changes the workspace
method, and skills are written directly under the paths above.

The default scaffold is a basic workspace method: English, small, and suitable for a
demo ingest/build cycle. It includes one demo source in `raw/untracked/`.

### Chat skills in `wiki serve`

The served chat exposes workspace skills as slash commands. Typing a matching
skill such as `/wiki-sync` switches from read-only chat to agent mode
and sends the literal invocation to the manager runtime. Serve does not expand
the skill body or execute mutations through its local chat path.

The runtime parses quoted arguments, compiles the body into delegable business
objectives, and resolves each objective only when its run starts. Every shipped
scaffold skill is one intention: `pipeline` remains one run and preserves the
production capability's internal DAG, and `/wiki-sync`, `/wiki-ingest`,
`/wiki-build` and `/deliver` are independent, replayable steps. Only a
user-authored body that opens a paragraph on `Puis` / `Then` / `if available`…
splits into a sequential run chain. The Activity panel displays the derived
skill chain (`done`, `running`, `cancelled`, `skipped` and its reason) from the
shared event-sourced control queue.

The scaffolded `/wiki-sync` skill runs the Confluence export path:

```text
cme_status
-> cme_sources_list
-> cme_export_run
-> cme_export_status
```

It always exports every configured source and uses the connector's existing
configuration as-is — it never asks which source to export and never
reconfigures credentials. It stops there: the exported Markdown waits in
`raw/untracked/` for a separate `/wiki-ingest`. A pending file modified by
hand since its delivery is never overwritten: it is flagged orange in the
Pending panel, and keeping or deleting it is yours to decide. Every step of
the chain is its own scaffold skill, replayable on its own:

- `/wiki-ingest [files]` — ingest what is already staged in `raw/untracked/`,
  without exporting anything first (`production_start_job {"type":"ingest"}`,
  optionally with an explicit `inputs` list). Use it when the files came from
  the documents agent or a manual copy rather than Confluence. It stops before
  starting a job when nothing is pending.
- `/wiki-build [template]` — build deliverables from the current wiki content
  (`production_start_job {"type":"build"}`), optionally for a single template,
  in `stabilize` mode when the deliverable already exists.
- `/deliver [deliverable] [polish]` — export, or polish, deliverables that already
  exist under `deliverables/` (`production_start_job {"type":"export"}` or
  `{"type":"polish"}`). Deliverable names are accepted with or without their `.md`
  extension, and a bare name is resolved across the `deliverables/`
  sub-directories; the export is written next to its deliverable, in the same
  tree. Polishing an already-exported `.export.md` is the normal second step
  (a polish-only pass writing `<name>.export.polished.md`); only an
  already-polished artifact is refused, naming its export.

`/pipeline` remains the one-shot shortcut for the whole chain.

Every scaffolded skill includes an **optional best-effort notification**. It
uses a messaging connector only when one is actually available and takes the
recipient from the workspace profile's `## Notifications` section. The message
uses the reply language. With no connector or recipient the notification is
skipped silently, and a notification failure never changes the skill outcome.

The final ingest step intentionally uses the `wiki-production` MCP server. The
llm-wiki MCP server is read/search/write oriented and does not expose a
`wiki_ingest` tool.

### Help & documentation

Bundled `help-doc/` Markdown chapters describe the whole product (DONNA, the
manager, agents, interfaces) — global, read-only, identical for every
workspace. Three ways to reach them:

- **In the chat** — the `?` button in the nav bar, or the `Help & documentation`
  tile on the empty chat, opens a slide-out panel with a table of contents and
  a per-chapter reading view.
- **In the browser** — `/help` lists the chapters, `/help/<id>` renders one.
- **Through DONNA** — the `help_list`/`help_read` MCP tools let Donna answer
  questions about the application itself (what it is, chat vs agent mode,
  getting started, troubleshooting) directly in chat, in the user's language.

### Desktop assistants

The MCP server can be used without starting ShellUI or `serve`. Claude Desktop
can launch the local stdio connector for one selected workspace. The shipped
desktop plugin and extension provide the local Claude Desktop integration. The
`wiki_graph_view` tool returns
structured graph data and a portable SVG image, so Claude can display the graph
when the client supports it. Workspace selection remains explicit and bound to
the connection; an assistant cannot switch workspaces through the text of a
prompt. See [MCP integration](docs/mcp.md).

The Claude plugin can also run workspace skills headlessly through
`wiki-manager`, without an MCP extension. It resolves the requested workspace
from the manager registry, asks for a workspace when several are available,
and preserves the exact skill name. See the plugin documentation for the
installation and usage details.

The empty chat also offers a quick-start tile:

- **Fill workspace profile** — prompts the user to describe the workspace
  context so that answers and deliverables are better tailored.

### Document context and Activity

In Chat mode, opening a Markdown wiki page adds a compact document badge above
the input. Up to five pages can be selected, and each badge can be removed
independently. A document converted from an upload is added automatically even
before ingestion, from `raw/untracked/`. The interface sends only these paths:
Donna reads the relevant files with the wiki read tools when the question
refers to the selected documents; their contents are not injected into every
prompt. The selection is part of the conversation: it is saved with it and
restored on reload, and "+ Context" on a wiki page opens the split view so the
document and the chat are visible together.

The Activity list has three scrollable tabs: **Plan** (tasks, queue, business
activity lines and the skill chain), **Files** (the local upload/conversion
feed) and **Logs** (essential run events plus the `assistant_progress` notes).
`Clear` cleans only the visible tab; `Clear all`, beside the List/Graph switch,
cleans all three views. These
actions do not delete the runtime plan. To abandon a failed or unsuitable plan,
use **Reset plan** in the Plan tab and confirm: active work is stopped and the
workspace runtime plan, activities, logs, queue, and persisted runtime state
are purged. The same reset remains available conversationally by explicitly
asking Donna to delete, reset, abandon, or replace the current plan; asking
only to stop work performs a non-purging stop.

The execution graph renders the run's collective too: each subagent declared by
the capability's `subagents` list (Scout, Red Team, Analyst, Critique,
Redactor, Archivist — the Red Team is supported but no packaged runtime
declares it) appears as a child node of the run node, with its status and
start/finish times in the inspector. For an external runtime run, the
collective's roles also drive the activity line: finished roles over the
declared ones, capped below 100% until the task itself ends.

### Agent proposals (curation review)

`agent.curate` runs work with confined hands: a git branch per objective, a
diff, never a direct write. When the run finishes, the proposal waits in the
review queue — a link with an amber badge in the left sidebar opens
`/agent-proposals`. The page explains what a proposal is and what each decision
does; each record reads as a summary ("3 wiki pages · Costs, Network · 1 new,
2 updated"), names files by label with New/Updated/Removed, renders the
justification as Markdown (links and `<br>` only, everything else escaped),
shows a coloured line-by-line diff, and keeps the paths, branch and proposal id
under a collapsed **Technical details**. A **Start a curation** button (offered
once the page is opened inside the chat shell) confirms, then starts a
curation through Donna — agent mode plus the canonical objective, never a
direct runtime call. **Merge into the wiki** applies the pages through the
normal write path (recording `verified` and `status: stable` in their OKF
frontmatter) and discards the branch; **Reject** discards it and leaves the
wiki untouched. Nothing reaches the wiki unless a human merges it. A curation
that wrote no file on its branch is a failure, reported with the runtime's
degradation causes: there is nothing to review.

## Core Commands

```bash
wiki init
wiki doctor                 # reports missing OKF keys; --apply writes them and migrates older pages to OKF v0.2
wiki ingest [files...]
wiki ingest --from-ingested [files...]   # rebuild TAXO fiches and tag-family pivots from the archived sources
wiki index
wiki query "question"
wiki build [templates...]
wiki build --plan
wiki refresh [templates...]
wiki export <deliverable> [--polish]
wiki lint [--with-llm]
wiki serve --port 3000
wiki mcp
wiki mcp-http --port 3333
```

## Configuration

Complete `.wikirc.yaml` reference (all fields; only set what you need):

```yaml
language: fr # or en, de, … (2-20 chars)

llm:
  provider: openai-compatible # openai-compatible | ai-gateway (routing only)
  engine: ollama # ollama | vllm | mlx | albert | openai | generic
  model: YOUR_MODEL_NAME
  apiKey: ollama # optional — leave empty for Ollama
  baseUrl: http://127.0.0.1:11434/v1
  temperature: 0.1 # 0–2, default 0.1
  timeoutMs: 600000 # per-request timeout in ms
  # Ollama-specific (ignored for other providers)
  numCtx: 32768 # context window size
  flashAttention: true # enable flash attention
  kvCacheType: q8_0 # f16 | q8_0 | q4_0

limits:
  requestsPerMinute: 10 # rate cap (default 10)
  maxInFlightRequests: 3 # concurrent in-job provider calls
  dailyInputTokens: 1000000 # optional daily budget
  maxInputTokensPerCall: 50000 # hard cap per LLM call
  targetInputTokensPerCall: 40000 # soft target for batch planning
  maxProfileChars: 4000 # max chars for source profiles

build:
  refreshOnIngest: true # rebuild stale deliverables after ingest
  slotBatchSize: 8 # optional max slots per build call
  maxBuildContextChars: 24000 # max chars of context per build call

retrieval:
  maxContextFiles: 5 # max wiki pages fed to LLM
  maxChunksPerPage: 2 # max vector chunks per page
  maxChunkChars: 3000 # max chars per chunk
  maxSourceChars: 8000 # max chars per source citation
  vector:
    enabled: false # set true to enable vector search
    baseUrl: http://127.0.0.1:7997/v1 # OpenAI-compatible embeddings endpoint
    apiKey: optional-key
    timeoutMs: 600000
    embeddingModel: BAAI/bge-m3
    rerankEnabled: true
    rerankerModel: BAAI/bge-reranker-v2-m3
    topK: 48 # candidates retrieved before rerank
    rerankTopK: 24 # candidates after rerank
    maxResults: 6 # final results passed to LLM

# MCP HTTP server bearer token (optional)
mcp:
  accessKey: your-bearer-token
```

TLS certificates (`WIKI_MCP_TLS_CERT_PATH`, `WIKI_SERVE_TLS_CERT_PATH`, etc.)
are set via environment variables or Docker Compose only — they are
infrastructure config, not workspace config. See `CLAUDE.md` for the full list.

The CLI automatically loads `.env` from the selected workspace before reading
`.wikirc.yaml` or interpolating `.wiki/mcp.endpoints.json`. Variables already
exported by the shell keep priority over values from `.env`.

Run `wiki doctor` after changing provider, model, context size, batch size, or
retrieval limits.

## Docker And Manager Use

For one standalone workspace, this repository can run directly or via its own
Docker setup.

For several workspaces, use `llm-wiki-manager`:

```bash
cd ../llm-wiki-manager
./wiki-workspace config <workspace>
./wiki-workspace up <workspace>
./wiki-workspace wiki <workspace> doctor
./wiki-workspace wiki <workspace> ingest
```

The manager owns Docker orchestration. The workspace still owns `.wikirc.yaml`,
templates, build context, skills, raw sources, and generated content.

When `WIKI_MANAGER_RUNTIME_URL` points `wiki serve` at a running
`llm-wiki-manager` agent runtime, the chat UI gains an Agent mode toggle
(agentic runs through the shared runtime instead of a local LLM call), a
config-profile picker in the chat header to switch `.wikirc` profiles without
restarting `serve`, and status/queue visibility into runs started from either
the browser or the manager shell. See `llm-wiki-manager`'s README for the
runtime's control lane and config-switching endpoints.

## Development

Requires Node.js 22+.

```bash
corepack enable
pnpm install
pnpm build
pnpm link --global
```

Useful commands:

```bash
pnpm dev doctor
pnpm typecheck
pnpm lint
pnpm test
```

## Documentation

| Topic                          | File                        |
| ------------------------------ | --------------------------- |
| Commands                       | `docs/commands.md`          |
| Content lifecycle (spec)       | `docs/content-lifecycle-spec.md` |
| Configuration                  | `docs/configuration.md`     |
| Docker                         | `docs/docker.md`            |
| Industrialisation / multi-user | `docs/industrialisation.md` |
| MCP                            | `docs/mcp.md`               |
| Templates                      | `docs/templates.md`         |
| Vector search                  | `docs/vector-search.md`     |

## License

Released under the PolyForm Noncommercial License 1.0.0. See `LICENSE`.

Commercial use requires separate terms. See `COMMERCIAL-LICENSE.md`.
