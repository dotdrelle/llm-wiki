# Repository Guide

## Purpose

`llm-wiki` is the local-first workspace engine. It ingests Markdown sources,
maintains a persistent wiki, builds retrieval indexes, serves the browser UI,
and regenerates deliverables from templates and build context.

Keep it usable both as a standalone CLI and as the engine called by
`llm-wiki-manager`.

## Layout

```text
bin/wiki.ts              Commander CLI entrypoint
src/commands/           Thin command wrappers
src/services/           Orchestration, IO, LLM, retrieval, MCP
src/prompts/            Prompt builders
src/chat/chatHtml.ts    Self-contained browser chat UI
scaffold/workspace/     Default workspace copied by `wiki init`
tests/                  Vitest coverage
docs/                   User-facing references
```

## Commands

- `init`: copy `scaffold/workspace`.
- `add-skill`: install one workspace skill package.
- `doctor`: validate provider, retrieval, build planning, and config.
- `ingest`: read `raw/untracked/`, update wiki pages, archive sources.
- `index`: build/update `.wiki/vector-index`.
- `query`: answer from wiki context.
- `build`, `refresh`, `export`, `lint`: generate and verify deliverables.
- `serve`: web UI, graph, chat, skills, API proxy.
- `mcp`, `mcp-http`: expose wiki tools over MCP.

## Workspace Skill Model

A workspace skill package uses this layout:

```text
skill.yaml
templates/
build-context/
.wiki/skills/
.wiki/system-prompt.md
CLAUDE.md
```

`wiki add-skill` validates before writing, rejects traversal and symlinks,
backs up replaced files under `.wiki/tmp/add-skill-*/backup`, replaces only
standard package paths, writes `.wiki/skill-install.json`, and appends a log
entry. This is intentionally one-skill-per-workspace; do not add multi-skill
merging without redesigning the model.

The default scaffold includes small UI skills such as `/status`, `/wiki-sync`,
`/pipeline`, and `/guide`. Keep scaffold skills generic and English by default.

## Serve Chat

`src/chat/chatHtml.ts` is a self-contained browser app. It has three separate
surfaces:

- MCP chain: technical call/result trace.
- Chat observation cards: compact read-only status/list results.
- Activity panel: uploads and actionable/asynchronous MCP work.

Trace mutations in `sendMessage` must go through `dispatchChatAgentEvent`.
Do not add direct `trace.steps.push()` mutations outside event handlers.
`parseToolJSON` accepts direct JSON, fenced JSON, and JSON embedded in textual
MCP envelopes; escape HTML at renderer boundaries.

Read-only observations should not create Activity entries unless the MCP server
returns an `_activity` contract. Async/actionable tools should be tracked in
Activity when they return `_activity.plan`, `_activity.progress`, or poll data.

## Serve Skills And Donna

Browser slash entries resolve against workspace skills from `.wiki/skills/`.
When `/guide` exists, the empty chat shows a `Start setup guide` tile, and the
empty Activity panel suggests the same action. First visit may auto-start
`/guide` only when:

- history loaded successfully,
- no conversation/history exists,
- the `guide` skill exists,
- localStorage has not recorded `llm-wiki-guide-autostart-done` for this
  workspace.

The second empty-chat tile, `Fill workspace profile`, should prompt the user to
populate `.wiki/profile.md`; it must not mutate files without confirmation.

Skill runs are multi-step workflows. Do not let observation-only tool calls
(`*_status`, `*_list`, logs, history, summaries) auto-finalize a skill run.
Sync/import skills should use the connected source tools first, then an ingest
or production job when available. The llm-wiki MCP does not expose a
`wiki_ingest` tool; ingestion is normally launched through the production/job
runner or the CLI.

## Important Services

- `workspaceService.ts`: path safety, workspace IO, skill installation.
- `ingestService.ts`: source-to-wiki LLM pipeline.
- `buildService.ts`: template slot batching and generation.
- `refreshService.ts`: stale deliverable detection.
- `exportService.ts`: citation expansion and polish.
- `retrievalService.ts`: lexical/vector context assembly.
- `vectorIndexService.ts`: LanceDB index management; oversized chunks are
  skipped for vector indexing only, with warnings.
- `llmService.ts`: OpenAI-compatible provider abstraction.
- `mcpServer.ts`: wiki MCP tools.

## Config And Environment

- `WIKI_CONFIG_PATH`: load a specific `.wikirc` profile, relative to workspace
  when not absolute.
- `WIKI_RUN_CALLER`: included in trace init events to link CLI traces to
  production jobs.
- TLS for `serve`: `WIKI_SERVE_TLS_CERT_PATH`, `WIKI_SERVE_TLS_KEY_PATH`,
  optional `WIKI_SERVE_TLS_CA_PATH`.
- TLS for `mcp-http`: `WIKI_MCP_TLS_CERT_PATH`, `WIKI_MCP_TLS_KEY_PATH`,
  optional `WIKI_MCP_TLS_CA_PATH`.

TLS paths resolve relative to the workspace when not absolute. Cert and key
must be supplied together. Keep TLS in env/Compose, not `.wikirc.yaml`.

## Safety Rules

- Never write outside the workspace root.
- Treat `raw/untracked/` as the only ingest input area.
- Treat `deliverables/` as generated and reproducible.
- Do not invent facts in generated content; cite available context.
- Preserve MCP bearer-token behavior: browser clients must not receive
  workspace MCP tokens.
- Keep skill install constrained to standard paths and reject symlinks.
- Keep Docker one-shot CLI usage separate from long-running `serve`.

## Validation

Before broad changes:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Focused checks:

```bash
pnpm exec vitest run tests/chat-html.test.ts
pnpm dev add-skill ./path/to/skill
pnpm dev build --plan
```

Runtime image note: `dist/bin/wiki.js` imports runtime dependencies and `serve`
resolves browser assets from `node_modules`. `EXPOSE 3000` does not start
`wiki serve`; Compose must run the desired command explicitly.
