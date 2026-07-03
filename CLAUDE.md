# Repository Guide

## Purpose

`llm-wiki` is the local-first workspace engine. It ingests Markdown sources,
maintains a persistent wiki, builds retrieval indexes, serves the browser UI,
and regenerates deliverables from templates and build context.

Keep it usable both as a standalone CLI and as the engine called by
`llm-wiki-manager`.

The multi-repo roadmap driving current work lives in `plan-directeur-revise.md`
at the wikiLLM workspace root (one level above this repo, not versioned here).
0.9.4 is the incremental, iso-behavior extraction of `src/commands/serve.ts`
and `src/chat/chatHtml.ts` into smaller modules (see Layout below); neither
file has reached its final target size yet, and `scripts/check-file-sizes.js`
keeps temporary legacy thresholds for both until it does. 0.9.5 (in progress)
is the runtime control-lane work described under Agent Runtime Integration.

## Layout

```text
bin/wiki.ts              Commander CLI entrypoint
src/commands/           Thin command wrappers; serve.ts is being split into
                         src/serve/ (routes/, proxy/, sse/) — see below
src/services/           Orchestration, IO, LLM, retrieval, MCP
src/prompts/            Prompt builders
src/chat/               Browser chat UI, split out of the former monolithic
                         chatHtml.ts (0.9.4): chatHtml.ts is now the assembly
                         point, importing styles/, views/, runtime/, config/,
                         workflow/ modules (all kept under 500 lines each;
                         chatHtml.ts itself still exceeds that, tracked by
                         check-file-sizes.js's legacy threshold)
src/serve/              Extracted from serve.ts (0.9.4, ongoing):
                         proxy/runtimeProxy.ts, sse/runtimeEvents.ts,
                         routes/runtimeRoutes.ts, routes/graphRoutes.ts
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

## Agent Runtime Integration

`wiki serve` can connect to a `llm-wiki-manager` agent runtime
(`WIKI_MANAGER_RUNTIME_URL`, `WIKI_MANAGER_RUNTIME_TOKEN`). When configured,
`serve.ts` proxies these routes:

- `GET /api/runtime/state` → runtime `/state`
- `GET /api/runtime/events` → runtime `/events/stream` (SSE pass-through)
- `POST /api/runtime/run` → runtime `/run` (injects `workspace: WORKSPACE_NAME`)
- `POST /api/runtime/cancel` → runtime `/cancel`
- `GET`/`POST /api/runtime/control` → runtime `/control` (status/explain/enqueue
  while a run is active — see `llm-wiki-manager/CLAUDE.md`'s control lane
  section)
- `GET /api/config/profiles`, `POST /api/config/use` → runtime `/config/*`
  (`.wikirc` profile switching, described below)

`proxyRuntimeJson` accepts an optional `extra` object merged into the POST body
before forwarding. The workspace injection (`{ workspace: workspaceNameFromEnv() }`)
is applied at the `/run` route so the runtime knows which workspace to load via
`/use`. Do not send runtime tokens to the browser — the proxy adds the
`Authorization` header server-side from `WIKI_MANAGER_RUNTIME_TOKEN`.

`GET /api/config/profiles` and `POST /api/config/use` proxy the runtime's
`.wikirc` profile switcher — the manager is the canonical source of which
profile is active. Serve never trusts the manager's raw `config` payload as
`AppConfig` directly: `mirrorRuntimeConfig` takes only the returned
`fileName`, validates it with `resolveProfileConfigPath` (must match
`.wikirc.yaml` or `.wikirc.yaml.*`, checked against path traversal via
`resolveInside`), then re-derives the config locally through the normal
`loadConfig()`/zod schema path before mirroring it into the live `config`
object. This keeps Serve's config shape schema-validated even though the
manager and Serve are separate processes with separate `.wikirc` parsers.

In `chatHtml.ts`, the Agent mode toggle (`toggleAgentMode()`) switches the chat
from local LLM to runtime dispatch. When running, the Send button becomes Stop
(POST `/api/runtime/cancel`). The Activity panel is populated from `runtimeState`
fetched via `/api/runtime/state` and kept fresh by the SSE stream with a 200ms
leading-edge debounce on `agent_event` messages.

`sendRuntimeAgentMessage` (0.9.5) no longer blocks with an error when a run is
already active: it posts to `/api/runtime/run` when idle, or
`/api/runtime/control {action:"message", input}` when busy (with a 409 fallback
from `/run` to `/control` for the idle→busy race), and shows the runtime's
`explanation` for the resulting `observe`/`converse`/`mutate`/`enqueue`/
`ambiguous` classification — see `llm-wiki-manager/CLAUDE.md`'s control lane
section for what each classification means. This is the same classifier the
ShellTUI uses; do not add a second one here.

`window.__WIKI_CONFIG__.runtime.enabled` is `true` when `WIKI_MANAGER_RUNTIME_URL`
is set; chatHtml uses this to show/hide the Agent mode toggle.

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

Local (non-Agent-mode) chat no longer sends MCP `tools` to the browser LLM
(`toolsPayload` in `sendMessage` is hardcoded `undefined`, 0.9.5) — per plan
directeur §4.1, tool-calling orchestration should exist in only one place
(the runtime/`agent/graph.js`), not duplicated in the browser. **Not yet
finished:** the `if(toolCalls?.length)` branch inside `sendMessage` and its
loop-detection/tool-dispatch machinery are now unreachable dead code (the LLM
is never offered tools, so it never returns `toolCalls`), but haven't been
deleted yet — removing them is the rest of §4.1's target, tracked as follow-up
work, not done in the same commit as the `toolsPayload` change.

All browser UI, MCP-facing labels, status strings, activity labels, and tests
for those surfaces must stay in English. The workspace `.wikirc` language is
used only for generated LLM-facing content and assistant answers, not for
local UI chrome.

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
- `WIKI_MANAGER_RUNTIME_URL`: URL of the `llm-wiki-manager` runtime
  (e.g. `http://host.docker.internal:7788`). Enables the Agent mode UI and
  runtime proxy routes in serve.
- `WIKI_MANAGER_RUNTIME_TOKEN`: Bearer token for the runtime. Added as
  `Authorization` header by the proxy; never forwarded to browser clients.
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
