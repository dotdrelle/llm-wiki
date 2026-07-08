# Repository Guide

## Purpose

`llm-wiki` is the local-first workspace engine. It ingests Markdown sources,
maintains a persistent wiki, builds retrieval indexes, serves the browser UI,
and regenerates deliverables from templates and build context.

Keep it usable both as a standalone CLI and as the engine called by
`llm-wiki-manager`.

This remains a single-user deployment baseline. Multi-user support is
specified in `docs/industrialisation.md` and planned next; do not treat the
runtime/write APIs as a shared multi-user boundary before that lot lands.

The multi-repo master plan is `plan-directeur-orchestration.md` at the wikiLLM
workspace root (one level above this repo, not versioned here); it supersedes
`plan-directeur-revise.md`. Its 0.12.0 "agnostic orchestration" lot is
implemented; in this repo it landed as the serve-side runtime UI updates:
structured runtime log display (filterable, no hard truncation), aggregated
and deduplicated runtime activity (weighted progress, no repeated identical
entries), the projected Run/Task runtime graph, and removal of the graph list
mode. The serve chat consumes the same runtime store/events as the manager
Shell UI — when a runtime event or projection changes in `llm-wiki-manager`,
update the corresponding `src/chat/runtime/` script here in the same release
window. Earlier per-lot history below is kept for context.
0.9.4 is the incremental, iso-behavior extraction of `src/commands/serve.ts`
and `src/chat/chatHtml.ts` into smaller modules (see Layout below); neither
file has reached its final target size yet, and `scripts/check-file-sizes.js`
keeps temporary legacy thresholds for both until it does. 0.9.5 is the runtime
control-lane work described under Agent Runtime Integration. 0.9.6 is the
`projectWorkflow` canonical projection (defined in `llm-wiki-manager`); this
repo consumes it as `runtimeState.workflow.nodes` in `runtimeTaskPanelHTML`
(`chatHtml.ts`), falling back to the legacy `runtimeState.plan`/`.activities`
shape when a runtime predates 0.9.6. 0.9.7 extracted the `/graph` page out of
`serve.ts` into `src/graph/` — a reusable D3 core (`src/graph/core/`: viewport,
selection, interactions, layout/render) plus a first, wiki-only projection
(`src/graph/wiki/projection.ts`: `buildWikiGraph`). `src/graph/core/graphTypes.ts`
defines `GraphNode`/`GraphEdge`/`GraphRenderDeps` with **plain-string** `type`
fields and no projection-specific concepts (no "page", "citation", etc.) —
`core/` must stay genuinely projection-agnostic. Anything vocabulary-specific
(DAG column order, relation-label text) is injected through `GraphRenderDeps`
(`dagColumnOrder`, `relationLabels`) by the caller — see
`WIKI_GRAPH_DAG_COLUMN_ORDER`/`WIKI_GRAPH_RELATION_LABELS` in
`src/graph/wiki/projection.ts` for the wiki projection's values — never
hardcoded inside `core/` itself (this was fixed after initially leaking wiki
type names into `graphLayoutBase.ts`/`graphSelection.ts`; don't reintroduce
that). 0.10.2 adds the Run/Task graph (see Serve Chat's Execution view below),
built on `src/graph/core/graphForce.ts` — the actual shared D3 mechanics
(radial force-simulation layout, node/link SVG creation) factored out for both
consumers. `src/graph/runtime/` stays an empty placeholder: the Run/Task
projection ended up living in `src/chat/runtime/runtimeGraphScript.ts`
instead (it consumes live `runtimeState.workflow` data via the same in-browser
script pipeline as the rest of the chat runtime UI, not a static-file
`buildXGraph()` projection like `graph/wiki/projection.ts` — there was nothing
Node/build-time to put in `graph/runtime/`). What *is* shared is
`graphForce.ts`'s D3 layer: `computeRadialForceLayout`/`renderForceLinks`/
`createForceNode` are called by both `runtimeGraphScript.ts` and (available
for) `graphLayoutBase.ts`'s radial mode. `graphLayoutBase.ts`'s own
toolbar/search/relation-panel/modal chrome and its DAG/Liste modes stay
wiki-specific — the Run/Task graph deliberately has none of that (plan
directeur §9.1: graph + inspector only, no page-content modal, no search). Do
not reintroduce a second, independent `d3.forceSimulation`/SVG-node-creation
implementation anywhere in this repo; extend `graphForce.ts` instead. 0.10.3
adds versioned contracts (`llm-wiki-manager` only) and, in this repo, MCP
write guards (`mcpServer.ts`, see Safety Rules) and MCP HTTP hardening
(`mcpHttp.ts`, see Config And Environment). 0.10.4 (knowledge-engine
quality) replaces naive lexical scoring with BM25 and adds ingestion
review/dry-run/reject and classified retry (see Important Services). 0.9.5,
0.9.6, 0.9.7, 0.10.0 (in `llm-wiki-manager` only), 0.10.2, 0.10.3, and 0.10.4
are released. 0.11.4 keeps the workspace config path intentionally direct:
provider keys live in `.wikirc.yaml` under `llm.apiKey` and
`retrieval.vector.apiKey` (no `apiKeyEnv`, no `WIKI_LLM_API_KEY` /
`WIKI_VECTOR_API_KEY` default path), exposes internal `wiki ingest --plan-only`
/ `--apply` plumbing for orchestrated parallel ingest, and writes
`.wiki/last-run.json` so `wiki build` can compare the current runtime/provider
summary with the previous build.

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
                         (graphRoutes.ts calls into src/graph/, see below —
                         no graph-building logic duplicated here)
src/graph/              /graph page, extracted out of serve.ts (0.9.7):
                         core/ is the reusable D3 socle (graphTypes.ts —
                         GraphNode/GraphEdge/GraphRenderDeps, projection-
                         agnostic; graphForce.ts — radial force-simulation
                         layout + node/link SVG creation, shared by both
                         graph consumers, added 0.10.2; graphViewport.ts,
                         graphSelection.ts, graphInteractions.ts,
                         graphLayoutBase.ts — zoom/pan, selection, focus,
                         search, relation panel/modal, the Radial/DAG/Liste
                         modes, all wiki-specific chrome built on top of
                         graphForce.ts/graphViewport.ts); wiki/projection.ts
                         is the first projection consuming it, over wiki
                         pages/sources/citations/templates/build-context/
                         deliverables; runtime/ stays an empty placeholder
                         (see its README) — the 0.10.2 Run/Task graph's
                         projection lives in src/chat/runtime/ instead,
                         since it consumes live browser-side runtime state
                         rather than a Node-side buildXGraph() projection,
                         but it reuses graphForce.ts for its D3 mechanics
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
- Activity panel: uploads and actionable/asynchronous MCP work. Has two
  views (`Liste`/`Graphe`, `setActivityView`, 0.10.2): list is the original
  card view; graph shows the Run/Task radial graph
  (`src/chat/runtime/runtimeGraphScript.ts`) fed by
  `runtimeState.workflow.nodes/relations` (the same `projectWorkflow`
  projection everywhere else in this repo — no second graph-building logic
  on top of raw `runtimeState.plan`/`.activities`). Selecting `Graphe`
  outside the Execution view opens the Activity panel with the graph
  centered and a per-node inspector (including recent logs) where the
  card list used to be.
- Execution view (`#execution-view`, `showExecutionView`/`showChatView`,
  0.10.2): a third top-level surface alongside Chat/Wiki (plan directeur
  §9.1 — no independent page, same chat app). Opens the Run/Task graph at
  the center with the Activity panel repurposed as inspector/logs on the
  right — the same graph and inspector markup as the Activity panel's
  `Graphe` view, just laid out differently (`body.execution-mode` toggles
  which container the graph/inspector render into).

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
- `ingestService.ts`: source-to-wiki LLM pipeline. `--dry-run` (`wiki
  ingest`) builds a review per planned operation (`buildReviewOperations`):
  before/after existence, SHA-256 hashes, and a compact unified-diff preview
  (`diffPreview`, capped at 12 lines), without writing. `--reject <path...>`
  drops one or more planned operations before applying; if every operation
  for a source is rejected, the source is not archived (`ingest:apply-skip`
  is logged, distinct from a genuinely empty plan, which still archives).
  `withRetry` classifies LLM planning failures (`classifyIngestError`):
  `validation` errors (malformed/ambiguous model output) never retry;
  `transient` errors (rate limit, timeout, connection reset) retry once with
  backoff and emit `ingest:retry`; anything else is `unknown` and still gets
  one retry. Do not add a second retry/classification path elsewhere — this
  is the only ingestion retry mechanism. `buildReviewOperations`'s
  `existingPages` map comes from `this.retrieval.warmCache()` (cached,
  invalidated by the existing `this.retrieval.invalidateCache()` call right
  after an apply) — not a raw `workspace.listWikiPages()` call, which would
  re-scan the whole wiki tree per source in a multi-source ingest and, if
  hoisted naively above the loop instead, would make a later source's diff
  preview ignore an earlier source's just-applied changes in the same run.
  Hashing anywhere in this repo goes through `utils/hash.ts`'s `hashText`;
  don't add a second SHA-256 wrapper (this happened once already, in
  `mcpServer.ts`, and was consolidated).
- `buildService.ts`: template slot batching and generation.
- `refreshService.ts`: stale deliverable detection.
- `exportService.ts`: citation expansion and polish.
- `retrievalService.ts`: lexical/vector context assembly. Lexical scoring is
  BM25 (`BM25_K1`/`BM25_B`, `buildBm25Corpus`/`scoreDocument`), not naive
  term-presence counting — `tokenize()` NFKD-normalizes and strips
  combining marks (accents) and apostrophes before matching, for
  language-sensitive (not just English) tokenization. Heading/page-name/
  path matches add a flat bonus on top of the BM25 term score, same as
  before. `wiki index` failure still falls back to this lexical path
  (`retrieval:vector-fallback` logged); do not add a second lexical scorer.
- `vectorIndexService.ts`: LanceDB index management; oversized chunks are
  skipped for vector indexing only, with warnings. `EMBED_BATCH_SIZE`/
  `EMBED_BATCH_MAX_CHARS` (exported) are the single source of truth for the
  embedding batch profile `wiki doctor` reports — don't hardcode those
  numbers as a second copy anywhere else.
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
- Auth for `mcp-http` (0.10.3): `WIKI_MCP_AUTH_TOKEN` (legacy, full
  read+write access) or the scoped pair `WIKI_MCP_READ_TOKEN` /
  `WIKI_MCP_WRITE_TOKEN` (`mcp.accessKey`/`readToken`/`writeToken` in
  `.wikirc.yaml`). `mcpScopesForToken`/`mcpToolScope`/`requiredScopeForJsonRpc`
  in `src/commands/mcpHttp.ts` derive the caller's scope with
  `timingSafeEqual` and gate `tools/call` for `wiki_write_page`/
  `profile_update` on write scope; unauthenticated access is only allowed
  when no token of any kind is configured. Requests are also rate-limited
  (`createMcpRateLimiter`, `WIKI_MCP_RATE_LIMIT_REQUESTS`/
  `WIKI_MCP_RATE_LIMIT_WINDOW_MS`, default 120/60s) keyed by token or,
  failing that, by `x-forwarded-for`/remote IP. The request body is read
  once (for scope classification) and passed to the MCP SDK's
  `transport.handleRequest(req, res, parsedBody)` — its documented mechanism
  for a pre-read body — rather than reconstructing a fake request stream.
  `hasAnyMcpToken(config)` is the single "is any token configured" check —
  don't re-derive the `accessKey || readToken || writeToken` condition
  inline elsewhere. `createMcpRateLimiter`'s sliding window shares its
  timestamp-pruning primitive (`pruneWindowTimestamps`, in
  `services/rateLimiter.ts`) with the outbound provider throttle
  (`throttleProviderRequestStart`) — same windowing math, reject-on-limit
  here vs. wait-and-retry there. Known, accepted gap: neither this map nor
  its per-token/IP counterpart in each Python agent evicts a key once its
  bucket empties, so a long-running process accumulates one entry per
  distinct caller seen over its lifetime; fixing that needs a periodic
  sweep, not attempted yet.

TLS paths resolve relative to the workspace when not absolute. Cert and key
must be supplied together. Keep TLS in env/Compose, not `.wikirc.yaml`.

## Safety Rules

- Never write outside the workspace root.
- Treat `raw/untracked/` as the only ingest input area.
- Treat `deliverables/` as generated and reproducible.
- Do not invent facts in generated content; cite available context.
- `wiki_write_page`/`profile_update` (0.10.3, `src/services/mcpServer.ts`)
  require `confirm=true` to actually write; omitting `confirm` or passing
  `dryRun=true` returns a JSON preview (`createWritePreviewPayload`: before/
  after SHA-256, a truncated unified diff) without touching disk.
  `profile_update` enforces `config.limits.maxProfileChars` before writing.
  Every attempt — preview, dry-run, rejected, or real write — appends one
  JSONL record to `.wiki/audit.log` (tool, target, action, confirmation
  state, content hashes; never full content).
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
