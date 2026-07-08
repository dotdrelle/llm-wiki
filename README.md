# llm-wiki

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

`llm-wiki` is a local-first Markdown knowledge engine.

It turns raw project material into a persistent wiki, builds a local retrieval
index, and regenerates deliverables from templates. It works as a standalone CLI
or as the workspace engine used by `llm-wiki-manager`.

The core rule is simple: the workspace is the source of truth. Sources, wiki
pages, templates, build rules, generated deliverables, traces, and skill state
all live on disk.

Scope note: this is a single-user deployment baseline. The multi-user model is
specified in `docs/industrialisation.md` and planned next; until then, keep
runtime write access local/proxied rather than exposing it as a shared
multi-user surface.

## Toolchain

| Repository | Role |
| --- | --- |
| [`llm-wiki`](https://github.com/dotdrelle/llm-wiki) | Workspace engine: CLI, web UI, MCP server, retrieval, deliverables, skills |
| [`llm-wiki-manager`](https://github.com/dotdrelle/llm-wiki-manager) | Multi-workspace cockpit, Docker orchestration, `dot` shell |
| [`agent-cme`](https://github.com/dotdrelle/agent-cme) | Workspace-scoped Confluence to Markdown exporter |
| [`agent-wiki-production`](https://github.com/dotdrelle/agent-wiki-production) | Workspace-scoped production jobs |
| [`agent-mailer-api`](https://github.com/dotdrelle/agent-mailer-api) | Optional external mailer MCP endpoint |

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
- expose internal ingest planning/apply phases for orchestrated parallel ingest;
- maintain durable wiki pages under `wiki/`;
- query the wiki with lexical and optional vector retrieval;
- generate deliverables from `templates/` and `build-context/`;
- show a build runtime/provider summary and compare it with the previous build;
- export deliverables with inline source detail;
- serve a local web UI and MCP endpoint;
- install a complete workspace skill with `wiki add-skill`.

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
wiki export deliverables/basic-note.md --polish
```

## Workspace Layout

```text
.
├── .wikirc.yaml              # provider/model/retrieval config
├── skill.yaml                # installed workspace skill metadata
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

A workspace skill is a complete installable method for one workspace. It may
define templates, build rules, chat/shell skills, a system prompt, and operator
instructions.

Install a skill from a directory, local zip file, or HTTP(S) zip URL:

```bash
wiki add-skill ./my-skill
wiki add-skill ./my-skill.zip
wiki add-skill https://example.test/my-skill.zip
```

Required package layout:

```text
skill.yaml
templates/
build-context/
.wiki/skills/
```

Optional package paths:

```text
.wiki/system-prompt.md
CLAUDE.md
```

Install behavior:

- the package is validated before modifying the workspace;
- path traversal and symlinks are rejected;
- each standard path present in the package replaces the same workspace path;
- the previous workspace path is backed up first under
  `.wiki/tmp/add-skill-*/backup`;
- old files from the previous skill do not remain mixed with the new one.

This is intentionally one-skill-per-workspace. Installing a skill changes the
workspace method.

The default scaffold is the `basic` skill: English, small, and suitable for a
demo ingest/build cycle. It includes one demo source in `raw/untracked/`.

### Chat skills in `wiki serve`

The served chat exposes workspace skills as slash commands. Typing a matching
skill such as `/wiki-sync` sends the skill body to the LLM while keeping the
displayed command readable in the conversation.

Skill runs keep going across status/list/log tool calls. Observation summaries
are not allowed to end a skill early; the run continues until the skill's actual
action has started or completed. Intermediate assistant status text remains
visible and is updated by later status or final output instead of disappearing.

The scaffolded `/wiki-sync` skill runs the Confluence-to-wiki path:

```text
cme_status
-> cme_sources_list
-> cme_export_run
-> cme_export_status
-> production_start_job {"type":"ingest"}
-> production_job_status
```

The final ingest step intentionally uses the `wiki-production` MCP server. The
llm-wiki MCP server is read/search/write oriented and does not expose a
`wiki_ingest` tool.

### Donna — interactive setup and discovery guide

The scaffolded `/guide` skill turns the chat into a step-by-step guided
onboarding session. It is designed for first-time users or anyone who wants to
verify that all workspace components are properly connected.

Donna (the `/guide` persona) works through five stages:

1. **LLM** — confirms the model is reachable (pre-configured from `.wikirc.yaml`
   in `wiki serve` mode; sidebar fields in standalone mode).
2. **Connected Capabilities** — calls available read-only tools to discover
   which connectors are active and which need setup.
3. **Configure Missing Connectors** — if a connector is present but not
   configured, asks only for the required credentials, then calls the matching
   setup tool after confirmation.
4. **Source Selection** — lists configured sources and offers to launch the
   appropriate sync or import workflow.
5. **Wiki Content & Deliverables** — inspects existing wiki pages and available
   templates; proposes the right generation action.

`/guide` is generic: it works with any combination of connectors present in the
workspace, not just Confluence or the default agent set.

The empty chat also offers two quick-start tiles alongside `/guide`:

- **Fill workspace profile** — prompts the user to describe the workspace
  context so that answers and deliverables are better tailored.
- **Get contextual tips** — Donna inspects the actual workspace state with the
  available read-only tools and returns 3 specific next-step suggestions in the
  configured workspace language.

On first visit (no conversation history), `/guide` starts automatically once,
then requires an explicit click. The auto-start flag is stored in local storage
per workspace scope and can be reset by clearing browser data.

## Core Commands

```bash
wiki init
wiki add-skill <directory-or-zip-or-url>
wiki doctor
wiki ingest [files...]
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
language: fr   # or en, de, … (2-20 chars)

llm:
  provider: ollama                          # ollama | openai | openai-compatible | anthropic
  model: YOUR_MODEL_NAME
  apiKey: ollama                            # optional — leave empty for Ollama
  baseUrl: http://127.0.0.1:11434/v1
  temperature: 0.1                          # 0–2, default 0.1
  timeoutMs: 600000                         # per-request timeout in ms
  # Ollama-specific (ignored for other providers)
  numCtx: 32768                             # context window size
  flashAttention: true                      # enable flash attention
  kvCacheType: q8_0                         # f16 | q8_0 | q4_0

limits:
  requestsPerMinute: 10                     # rate cap (default 10)
  maxInFlightRequests: 3                    # concurrent in-job provider calls
  dailyInputTokens: 1000000                 # optional daily budget
  maxInputTokensPerCall: 50000              # hard cap per LLM call
  targetInputTokensPerCall: 40000           # soft target for batch planning
  maxProfileChars: 4000                     # max chars for source profiles

build:
  refreshOnIngest: true                     # rebuild stale deliverables after ingest
  slotBatchSize: 8                          # optional max slots per build call
  maxBuildContextChars: 24000               # max chars of context per build call

retrieval:
  maxContextFiles: 5                        # max wiki pages fed to LLM
  maxChunksPerPage: 2                       # max vector chunks per page
  maxChunkChars: 3000                       # max chars per chunk
  maxSourceChars: 8000                      # max chars per source citation
  buildStrategy: bm25                       # bm25 for build context; hybrid re-enables vector/rerank in build
  vector:
    enabled: false                          # set true to enable vector search
    baseUrl: http://127.0.0.1:7997/v1       # OpenAI-compatible embeddings endpoint
    apiKey: optional-key
    timeoutMs: 600000
    embeddingModel: BAAI/bge-m3
    rerankEnabled: true
    rerankerModel: BAAI/bge-reranker-v2-m3
    topK: 48                                # candidates retrieved before rerank
    rerankTopK: 24                          # candidates after rerank
    maxResults: 6                           # final results passed to LLM

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
pnpm dev add-skill ./path/to/skill
pnpm typecheck
pnpm lint
pnpm test
```

## Documentation

| Topic | File |
| --- | --- |
| Commands | `docs/commands.md` |
| Configuration | `docs/configuration.md` |
| Docker | `docs/docker.md` |
| Industrialisation / multi-user | `docs/industrialisation.md` |
| MCP | `docs/mcp.md` |
| Templates | `docs/templates.md` |
| Vector search | `docs/vector-search.md` |

## License

Released under the PolyForm Noncommercial License 1.0.0. See `LICENSE`.

Commercial use requires separate terms. See `COMMERCIAL-LICENSE.md`.
