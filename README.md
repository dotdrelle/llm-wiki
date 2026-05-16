# llm-wiki

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](https://polyformproject.org/licenses/noncommercial/1.0.0/)

Open-source implementation of [Karpathy's LLM Wiki](https://x.com/karpathy/status/2039805659525644595) ([spec](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)).

A local-first CLI that turns raw project material into a durable, searchable Markdown knowledge base, then generates reproducible deliverables from templates. Works with OpenAI, Anthropic, Ollama, or any OpenAI-compatible server. Everything stays on disk as plain Markdown files.

`llm-wiki` is the workspace engine: it initializes workspaces, ingests `raw/untracked`, serves a local UI, exposes a wiki MCP server, and builds/exports deliverables.

It can run by itself, but it is one part of a three-repository toolchain:

| Repository | Role |
| ---------- | ---- |
| [`llm-wiki`](https://github.com/dotdrelle/llm-wiki) | Local-first wiki CLI, web UI, MCP server, retrieval, and deliverable builder |
| [`llm-wiki-manager`](https://github.com/dotdrelle/llm-wiki-manager) | Docker cockpit for multiple wiki workspaces, workspace-scoped Confluence export, and production agents |
| [`agent-cme`](https://github.com/dotdrelle/agent-cme) | Agent-controlled Confluence Markdown exporter used by the manager |

Use only this repository for a single standalone workspace. Use
`llm-wiki-manager` when you want Docker orchestration for several workspaces,
workspace-scoped Confluence export agents, production jobs, and shared action
agents.

```
┌──────────────────────────────────────┐  ┌─────────────────────────────────────┐
│  raw sources                         │  │  AI assistant                       │
│  notes, exports, Confluence, PDFs    │  │                                     │
│  → raw/untracked/                    │  │  wiki mcp-http  (Streamable HTTP)   │
└──────────────┬───────────────────────┘  │  wiki_read_page(s) · wiki_write_page │
               │  wiki ingest  (LLM)      │  wiki_search_context · wiki_collect_context│
               ▼                          └──────────────────┬──────────────────┘
┌──────────────────────────────────────┐                     │
│  wiki/                        ◄──────┼─────────────────────┘
│  ├── index.md                        │── wiki index ──► ┌────────────────────┐
│  ├── concepts/                       │   (embeddings)   │ .wiki/vector-index │
│  ├── sources/  (raw/ingested/)       │◄─────────────────┤   (LanceDB)        │
│  └── answers/                        │   (retrieval)    └────────────────────┘
└──────┬────────────────┬──────────────┘
       │  wiki query    │  wiki build / refresh  (LLM)
       ▼                ▼
┌────────────┐  ┌───────────────────────────────────────┐
│  answers   │  │  templates/  [[INSTRUCTION: ...]]     │
└────────────┘  │  build-context/  (fixed context)      │
                └──────────────────────┬────────────────┘
                                       ▼
                              ┌─────────────────┐
                              │  deliverables/  │
                              └────────┬────────┘
                                       │  wiki export  (LLM)
                                       ▼
                              ┌─────────────────┐
                              │  *.export.md    │
                              └─────────────────┘
```

## Quick start

1. **Initialize a workspace** in an empty directory:

   ```bash
   wiki init
   ```

   Edit `.wikirc.yaml` to set your LLM provider, model, `language`, retrieval endpoints, and prompt limits.

2. **Run the doctor** to validate your configuration:

   ```bash
   wiki doctor
   ```

3. **Drop sources** into `raw/untracked/` (Markdown, Confluence exports, etc.).

4. **Ingest** — the LLM reads each source and updates `wiki/`:

   ```bash
   wiki ingest
   ```

5. **Build deliverables** from templates in `templates/`:

   ```bash
   wiki build
   ```

   To inspect the planned LLM calls before generating content:

   ```bash
   wiki build --plan
   ```

6. **Export** a self-contained document from a deliverable:
   ```bash
   wiki export deliverables/project-brief.md --polish
   ```

Repeat steps 3–4 as new sources arrive. Run `wiki refresh` to rebuild stale deliverables without re-ingesting.

## Docker and Multi-Workspace Use

For a single workspace, you can use this repository's Docker Compose file by setting `WIKI_WORKSPACE`.

For several workspaces, use `llm-wiki-manager` as the cockpit:

```bash
cd ../llm-wiki-manager
./wiki-workspace config <workspace>
./wiki-workspace up <workspace>
./wiki-workspace wiki <workspace> doctor
./wiki-workspace wiki <workspace> ingest
```

`wiki init` creates workspace content and `.wikirc.yaml`. It does not create a workspace-local `docker-compose.yml`; Docker orchestration lives either in this repository for one workspace or in `llm-wiki-manager` for several workspaces.

## Installation

Requires Node.js 22+.

```bash
corepack enable
pnpm install
pnpm build
pnpm link --global   # makes `wiki` available system-wide
```

Development:

```bash
pnpm dev ingest      # run without building first
pnpm typecheck
pnpm test
```

## Workspace layout

```text
.
├── .wikirc.yaml
├── CLAUDE.md
├── .wiki/                  ← internal, gitignored
│   ├── build-state.json
│   ├── logs/
│   └── vector-index/       ← created by `wiki index`
├── raw/
│   ├── untracked/          ← drop sources here
│   └── ingested/           ← archived after ingest
├── wiki/
│   ├── index.md
│   ├── log.md
│   ├── concepts/
│   ├── sources/
│   └── answers/
├── templates/
├── build-context/
└── deliverables/
```

## Documentation

| Topic                                          | Description                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| [docs/commands.md](docs/commands.md)           | All CLI commands with options and examples               |
| [docs/configuration.md](docs/configuration.md) | `.wikirc.yaml` reference (all keys and providers)        |
| [docs/docker.md](docs/docker.md)               | Docker and docker-compose setup                          |
| [docs/mcp.md](docs/mcp.md)                     | MCP integration (Claude Desktop, Claude Code, OpenWebUI) |
| [docs/templates.md](docs/templates.md)         | Deliverable templates and importing sources              |
| [docs/vector-search.md](docs/vector-search.md) | Optional vector retrieval with LanceDB                   |

## License

Released under the **PolyForm Noncommercial License 1.0.0** — free for personal, academic, and non-commercial use. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for commercial terms.
