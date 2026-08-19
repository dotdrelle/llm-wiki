# Repository Guide

The Wiki browser graph is Canvas-only: keep Wiki UI code under
`src/graph/wiki`, share the camera/frame scheduler from `src/graph/core/canvas/`
with Run/Task, and do not restore the removed D3/SVG renderers or legacy graph
endpoints.

## Purpose

`llm-wiki` is the local-first workspace engine. It ingests Markdown sources,
maintains a persistent wiki, builds retrieval indexes, serves the browser UI,
and regenerates deliverables from templates and build context.

Keep it usable both as a standalone CLI and as the engine called by
`llm-wiki-manager`.

This remains a single-user deployment baseline. Multi-user support is
specified in `docs/industrialisation.md` and planned next; do not treat the
runtime/write APIs as a shared multi-user boundary before that lot lands.

Multi-repo context lives in `CLAUDE.md` at the wikiLLM workspace root (one
level above this repo, not versioned here). The "agnostic orchestration" lot
it describes is implemented; in this repo it landed as the serve-side runtime
UI updates:
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
`serve.ts` into `src/graph/` — a reusable graph core plus a wiki-only projection
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
built on the shared Canvas camera and invalidation scheduler in
`src/graph/core/canvas/`. `src/graph/runtime/` documents the browser-owned
Run/Task projection; the Run/Task
projection ended up living in `src/chat/runtime/runtimeGraphScript.ts`
instead (it consumes live `runtimeState.workflow` data via the same in-browser
script pipeline as the rest of the chat runtime UI, not a static-file
`buildXGraph()` projection like `graph/wiki/projection.ts` — there was nothing
Node/build-time to put in `graph/runtime/`). Both surfaces render through
Canvas, retain positions, use mini-maps and stop scheduling frames when idle.
Do not reintroduce D3, SVG node creation, or an independent camera/frame loop.
0.10.3
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
                         core/canvas contains projection-agnostic scene types,
                         bounded camera transitions and an idle-aware frame
                         scheduler shared by both graph consumers;
                         wiki/projection.ts
                         is the first projection consuming it, over wiki
                         pages/sources/citations/templates/build-context/
                         deliverables; runtime/ stays an empty placeholder
                         (see its README) — the 0.10.2 Run/Task graph's
                         projection lives in src/chat/runtime/ instead,
                         since it consumes live browser-side runtime state
                         rather than a Node-side buildXGraph() projection,
                         and reuses the shared Canvas camera/scheduler
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
- `taxonomy`: bounded synthesis of the graph taxonomy. Without `--apply` it
  prints the exact prompt it would send and costs nothing — that dry run is the
  calibration tool, so it must read the active registry like `--apply` does.
  `--fingerprint` returns the knowledge fingerprint the production barrier
  freezes; `--expected-corpus` is the compare-and-swap on publication.
- `release`: tag the current workspace state (`release-<n>` or `--label`), or
  `--list`. A release is a git tag, never a history rewrite: the invariant is
  revert-forward, so older commits are folded out of the `/history` list and stay
  fully restorable.

## Taxonomy — what the model is allowed to see

The synthesis prompt is built from `buildTaxonomyInventory`, and two of its
inputs were dead or dangerous:

- **Excerpts.** `SynthesizeDeps.excerpts` existed, was threaded through, and no
  caller ever filled it — so the model named conceptual domains from title
  strings alone, which describe the editorial form of a document, not its
  subject. `commands/taxonomy.ts` now reads the first lines of each knowledge
  page (bounded pool, like `buildWikiGraph`) and each family carries the excerpt
  of its most central member. Keep the budget linear in families, never per page.
- **Previous communities.** They are emitted as continuity — reuse a label when
  the subject has not changed — but **only** when they come from a published
  registry (`TaxonomyInventory.communitiesFromRegistry`). Without a registry the
  field falls back to the deterministic graph projection, whose labels come from
  `group:` seeds and include an `Ungrouped` bucket; presenting those as
  continuity would reintroduce the `group:`-as-identity defect Lot 0 removed, and
  hand the model a catch-all label its own rules forbid.

Naming stability is decided by the hysteresis in `taxonomy/consolidation.ts`
(`RENAME_MIN_STABILITY`, `RENAME_MIN_REVISION_GAP`), not by the draft label. Its
verdicts (`created` / `renamed` / `kept` / `unchanged`, with the member overlap)
are published on the outcome and printed by `wiki taxonomy --apply`: those two
constants are only tunable against observed counts. Many `kept` means the model
keeps proposing renames the engine refuses; many `renamed` means the map moves
under the reader. `--force` lifts the hysteresis entirely.

## Workspace Skill Model

A workspace skill package uses this layout:

```text
templates/
build-context/
.wiki/skills/
.wiki/system-prompt.md
CLAUDE.md
```

The fixed required directories are the package entry point; there is no root
manifest. `wiki add-skill` validates before writing, rejects traversal and symlinks,
backs up replaced files under `.wiki/tmp/add-skill-*/backup`, replaces only
standard package paths, writes `.wiki/skill-install.json`, and appends a log
entry. This is intentionally one-skill-per-workspace; do not add multi-skill
merging without redesigning the model.

The default scaffold includes small UI skills: `/status`, `/diagnose`, and the
production chain `/wiki-sync` (source export + ingest, optional source name) →
`/wiki-build` (build, optional template) → `/deliver` (export or polish, optional
deliverable + `polish` flag), with `/pipeline` as the one-shot shortcut.
`/wiki-ingest` (optional file list) is `/wiki-sync` without the export: it
ingests what already waits in `raw/untracked/`, whatever staged it.

Scaffold skill bodies are **business intentions**, not procedures: they state
the outcome, the guardrails and the reporting, and never name an MCP server, a
tool or a job type. The manager's compiler turns a body into one delegable
intention per strong boundary, so the markdown shape is load-bearing — a body
written as a numbered list of phases becomes that many runs. Keep each shipped
skill on one intention, except `wiki-sync`, whose second paragraph opens with
`Then` precisely so the export and the ingest become two sequential runs.
`pipeline` must stay a single intention: splitting it would take the production
capability's own DAG and concurrency away from it.

Params are positional and whitespace-separated. The manager appends them as a
`User parameters:` block to every objective of a chain; the legacy `{param}`
substitution still works when a body contains the placeholder, and such a body
must tolerate an empty one. Each skill ends with an optional, best-effort email
notification written without naming any server or tool — phrased inline so it
never becomes an extra run. Keep scaffold skills generic and English by default.

## Agent Runtime Integration

`wiki serve` can connect to a `llm-wiki-manager` agent runtime
(`WIKI_MANAGER_RUNTIME_URL`, `WIKI_MANAGER_RUNTIME_TOKEN`). When configured,
`serve.ts` proxies these routes:

- `GET /api/runtime/state` → runtime `/state`
- `GET /api/runtime/events` → runtime `/events/stream` (SSE pass-through)
- `POST /api/runtime/run` → runtime `/run` (injects `workspace: WORKSPACE_NAME`)
- `POST /api/runtime/cancel` → runtime `/cancel`
- `POST /api/runtime/approve` → runtime `/approve` (grants the pending run-scope
  approval; used by the serve approval banner's Approve button)
- `POST /api/runtime/reset` → workspace-scoped runtime `/kill?purge=true`
  (confirmed destructive reset of the current plan/runtime projection)
- `POST /api/runtime/conversation/truncate` → workspace-scoped runtime
  `/conversation/truncate` (redo: keeps the conversation entry at `index` and
  drops everything recorded after it). Backs the `Redo` button on user
  messages. The runtime derives its conversation from the event log, so a
  DOM-only deletion would be merged straight back in by the next poll; the
  runtime answers `409 run_active` while a run is in progress.
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
already active: ordinary Agent messages post to `/api/runtime/turn` when idle,
or
`/api/runtime/control {action:"message", input}` when busy (with a 409 fallback
from `/run` to `/control` for the idle→busy race), and shows the runtime's
`explanation` for the resulting `observe`/`converse`/`mutate`/`enqueue`/
`ambiguous` classification — see `llm-wiki-manager/CLAUDE.md`'s control lane
section for what each classification means. This is the same classifier the
ShellTUI uses; do not add a second one here.

`window.__WIKI_CONFIG__.runtime.enabled` is `true` when `WIKI_MANAGER_RUNTIME_URL`
is set; chatHtml uses this to show/hide the Agent mode toggle.

Direct Chat can send `context.openWikiPages` through `/api/runtime/turn`. The
browser keeps at most five distinct Markdown paths selected from `wiki/` or
`raw/untracked/`; opening a wiki page or successfully converting an upload adds
its path. These are references only: never read or inline document content in
the browser or proxy. Donna receives the sanitized paths in its prompt and must
use its allow-listed read tools. The MCP `wiki_read_page`/`wiki_read_pages`
tools therefore allow `wiki/`, `raw/ingested/`, and `raw/untracked/`, while the
shared workspace-root/path-traversal guard remains authoritative.

## Serve — what must survive a change of centre view

The shell has four centre views (chat, wiki, connectors, execution) and hides
`#input-wrap` in three of them. Anything the workspace demands of its reader must
therefore live **outside** that block:

- `#approval-banner` is a fixed overlay, a sibling of `#main`, not a child. Inside
  the composer it was invisible exactly where it mattered — a restore launched
  from `/history` waited on an approval nobody could see. It is kept out of
  `#main` too: `#main` is a flex column normally and an explicitly-placed grid in
  split mode, so a new child there needs a placement in both.
- The type filters of the wiki graph govern **three** surfaces: the left index,
  the canvas and the right inspector. `renderCommunityInspector` is split from
  `selectCommunity` precisely so a filter change can replay the panel; the panel
  head announces `N of M documents` when a filter hides some, because counting
  one thing and listing another is how the three counters came to disagree.
- Chat context accepts `wiki/`, `raw/untracked/` **and** `raw/ingested/`. That
  list must match what the graph offers a "Send to Donna" button on, otherwise
  the button is offered on pages the shell silently refuses. The graph waits for
  `llmwiki:addContext:result` before claiming success — it used to turn green
  before the message was even read.

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

Runtime UI surfaces added alongside the graph (keep in lock-step with the
manager's `state.concurrency` / `workflow.timingByTask` — see
`llm-wiki-manager/CLAUDE.md`):

- **Approval banner** (`#approval-banner`, `chatView.ts`/`chatHtml.ts`): amber
  strip above the composer with Approve/Reject, shown whenever
  `runtimeState.approvals` or a plan task is `pending_approval`. Approve →
  `POST /api/runtime/approve {scope:'run'}`; Reject cancels the run.
- **Run summary** (`runtimeWorkflowSummaryHTML`, also reused in the Plan tab):
  `agents · Parallel active/max ×N · done/total · tokens`. The `×N` is the
  authoritative resolved concurrency from `runtimeState.concurrency.limit`
  (fallback: plan-derived), with an amber `(ceiling)` marker when the manager
  ceiling binds.
- **Execution graph** (`runtimeGraphScript.ts`): the `run` node carries a
  `parallel ×N` sub-label + inspector `Parallelism` row from the same
  `state.concurrency`; clicking a phase lists its tasks ordered by start time
  with per-task duration (`workflow.timingByTask`) and tokens in/out
  (`workflow.usage.byTask`). Filled `task_group` rectangles render white text
  without the halo stroke (`.runtime-graph-node.task_group text`). Aggregator
  status glyphs are `[✓]`/`[✗]`/`[⏸]`, aligned with the Shell PlanPanel.

The Activity list is split into `Plan`, `Chain`, `Local activity`,
`Runtime activity`, and `Logs`, in that order. Each tab owns a `Clear` action;
`Clear all` beside the List/Graph switch applies all five. Local clearing
removes browser-owned upload/MCP cards, while clearing the other tabs hides the
current runtime snapshot until new state changes its fingerprint. This is
deliberately not a runtime deletion. `Reset plan`, shown only in the Plan tab,
requires browser confirmation and calls `/api/runtime/reset`; it stops active
work and purges the workspace runtime plan, activities, logs, queue, and
persisted projection. Upload cards with an `error` always render as failed even
if storage succeeded.

**Connector cards** (`src/chat/runtime/mcpConnectorScript.ts`,
`config/configScript.ts`, `chatHtml.ts`). A card now has an identity in the
runtime, not only in the browser. Four fields carry it, all persisted in
`localStorage` by `saveServers`:

- `origin` — `builtin` (`llm-wiki`, `wiki-production`: read-only fields, no
  delete button, `removeServer` refuses), `global` (declared in the manager's
  `mcp.endpoints.json`), `ui` (added here). Computed server-side in
  `chatRoutes` from `managedBy === 'serve-ui'`, so it survives a reload —
  never infer it in the browser.
- `persistedName` — the name the runtime actually knows. Renaming only changes
  `name`; the next connect sends both as `previousName`/`name` so the manager
  performs an atomic rename. Deletion always targets `persistedName`.
- `needsSync` / `syncError` — the MCP handshake and the runtime write are two
  independent concerns and must not share a `catch`. A successful handshake
  followed by a failed write (409 while a plan runs, name refused, runtime
  down) leaves the card **connected and enabled**, badged `local only`; the
  write is retried on the next reconnect. Marking it `err` would remove a
  working server's tools from chat because the runtime happened to be busy.

`chatRoutes` re-reads the endpoints file per request
(`externalMcpEndpoints` is a thunk, not a boot-time array) — a connector added
from the UI must appear in `__WIKI_CONFIG__.mcpServers` on the next page load
without restarting serve. `mcpRoutes`/`uploadRoutes` still hold the boot
snapshot; they only need it to resolve outbound headers for file-declared
endpoints.

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

The workspace-level **general conversational-action rule** applies here: every
action originating in chat UI — natural language, slash command, suggestion
tile or shortcut — enters through a Donna `/turn`. Browser code may recognize a
public command to switch modes, but it must not invoke `/run` directly, compile
or execute private instructions, expose them as messages, or synthesize an
acknowledgement. Donna owns selection, launch and all user-facing responses.
Only explicitly non-conversational headless/CI callers may bypass the turn.

Browser slash entries resolve against workspace skills from `.wiki/skills/`.
An entry that matches an executable skill switches the composer to agent mode
and posts to `/api/runtime/turn`. The runtime deterministically recognizes an
explicit `/skill` invocation, then reads and compiles its private body for Donna
to execute; the browser never compiles or executes a skill itself. Ordinary
prose and informational questions still reach Donna without this interception.
`matchBrowserSkillInvocation` holds a copy of the manager's
`RESERVED_SLASH_COMMANDS` list — `/status` and friends stay built-ins on both
sides, and the two lists must be changed together. An explicit `forceChat` wins
over the switch.

The Activity panel renders a dedicated **Chain** tab from
`runtimeState.skillChains`, the projection the runtime publishes over the
control queue, with one line per step (`✓ ● × –`), its status and its
`skipReason`. A chain disappears once it is fully `done`; it stays visible when
it was cancelled or left incomplete, which is exactly when the user needs to
see which steps were skipped. Styles live in `styles/chatActivityStyles.ts`
under `.chain-*`.

The empty chat's first tile and the empty Activity panel's button both open
the Help panel (`toggleHelpPanel()`) — a slide-out reader over the bundled,
global `help-doc/` chapters (`src/utils/helpDoc.ts`), also reachable at
`/help`/`/help/:id` and through the `help_list`/`help_read` MCP tools. This is
static, workspace-independent documentation, not a workspace skill: it never
auto-starts and has no per-workspace customization (unlike `.wiki/skills/`
entries, which are per-workspace and can be edited via `wiki add-skill`).

The second empty-chat tile, `Fill workspace profile`, should prompt the user to
populate `.wiki/profile.md`; it must not mutate files without confirmation.

Skill runs are multi-step workflows. Do not let observation-only tool calls
(`*_status`, `*_list`, logs, history, summaries) auto-finalize a skill run.
Sync/import skills should use the connected source tools first, then an ingest
or production job when available. The llm-wiki MCP does not expose a
`wiki_ingest` tool; ingestion is normally launched through the production/job
runner or the CLI.

## Important Services

- `historyService.ts`: the workspace's own git history. Two rules and one trap.
  It is **revert-forward only** — no `reset`, `rebase`, `push` or `amend`, and a
  test enforces that on the source, which is why a release is a tag and not a
  rewrite. Every mutating surface must write its own commit: a deletion from the
  left tree used to leave none, so it floated in `git status` until some later
  `ingest:` commit swallowed it under a message about something else. The trap:
  `git log` separates records with the format's `%x1e` **and its own newline**, so
  splitting on the separator alone left a `\n` at the head of every entry but the
  first — it landed in `%H`, and every `sha` below the top row was unusable for
  expanding or restoring. Strip the leading newline per record, never by trimming
  the whole output.
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
  `timingSafeEqual` and gate `tools/call` for `wiki_write_page`,
  `wiki_add_source`, and `profile_update` on write scope; unauthenticated access is only allowed
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
  `wiki_add_source` writes Markdown directly to the workspace-configured
  ingestion inbox, uses `dryRun=true` for preview, and requires
  `overwrite=true` to replace an existing staged source. It has no `confirm`
  argument: authorization comes from MCP write scope and runtime approval.
  Every attempt — preview, dry-run, rejected, or real write — appends one
  JSONL record to `.wiki/logs/audit.log` (tool, target, action, confirmation
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
