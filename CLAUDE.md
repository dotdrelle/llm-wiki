# Repository Guide

The Wiki browser graph is Canvas-only: keep Wiki UI code under
`src/graph/wiki`, share the camera/frame scheduler from `src/graph/core/canvas/`
with Run/Task, and do not restore the removed D3/SVG renderers or legacy graph
endpoints. The `/graph` page is the TAXO reading (Families, Concepts, Concept
focus, Concepts + sources — `src/graph/wiki/ui/taxo/`); its force layouts are
settled **server-side** with `d3-force` (`taxoLayout.ts`), so the browser still
never loads D3. **One documented exception:** the `/provenance?id=<deliverable>`
page (`src/graph/wiki/ui/provenance/`) is plain HTML with SVG connectors, not a
Canvas view. It draws one deliverable's evidence chain — a few dozen nodes —
whose value is text (titles, paths, anchors, the exact frozen passage, badges,
warnings); the Canvas renderer truncated all of it, so the approved HTML
mock-up is what ships, fed by `/api/graph/provenance` (`provenanceGraph.ts`, a
reader of the build's evidence manifest — see `docs/provenance.md`). Do not
extend that exception to the TAXO views. The deliverable page's actions
(Export / polish, Provenance) live in `src/serve/html/deliverableActions.ts`.

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
keeps temporary legacy thresholds for the still-unsplit files until they do
(`serve.ts`, `chatHtml.ts`, `wikiHtml.ts`, `activityPanelScript.ts` — the
ceilings record the shipped reality and drop as the extractions land).
0.9.5 is the runtime
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
Canvas, retain positions and stop scheduling frames when idle. Do not
reintroduce D3 in the browser, SVG node creation, or an independent
camera/frame loop. (The TAXO wiki graph's force layouts are settled in Node;
the browser only draws.)
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
`WIKI_VECTOR_API_KEY` default path), and writes
`.wiki/last-run.json` so `wiki build` can compare the current runtime/provider
summary with the previous build. TAXO is now the sole ingest cycle and the
retired plan/apply plumbing (`--plan-only`, `--apply <file...>`, ingest plan
files) is gone: `--dry-run`/`--reject` remain, `--apply` now applies
`--migrate-sheets`, and `--from-ingested` rebuilds from the archive.

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
- `doctor`: validate provider, retrieval, build planning, and config.
- `ingest`: read `raw/untracked/`, update wiki pages, archive sources.
  `--from-ingested` rebuilds concept pages from the ARCHIVED sources
  (`raw/ingested/`) instead — the archive identity is preserved (no sibling
  "ingested-…" paths), nothing is moved or archived again, and the
  unchanged-since-last-ingest skip is bypassed on purpose.
- `index`: build/update `.wiki/vector-index`.
- `query`: answer from wiki context.
- `build`, `refresh`, `export`, `lint`: generate and verify deliverables.
- `serve`: web UI, graph, chat, skills, API proxy.
- `mcp`, `mcp-http`: expose wiki tools over MCP.
- `release`: tag the current workspace state (`release-<n>` or `--label`), or
  `--list`. A release is a git tag, never a history rewrite: the invariant is
  revert-forward, so older commits are folded out of the `/history` list and stay
  fully restorable.

## Concepts & taxonomy — the TAXO model

TAXO is the sole ingestion workflow; there is no user-facing analysis/apply
split or separate regroup job. For each source, the engine divides meaningful
sections, asks the model to faithfully reshape each section, and writes one
evidence-bearing fiche under `wiki/sources/<document>/<section>.md`. Each fiche
keeps its source locator, tags and citation to `raw/ingested/`. A deterministic
engine stage then harmonizes tag spelling and the model assigns tags to semantic
families. Generated pivots live under `wiki/concepts/<family>/<tag>.md`; they
link to fiches and are navigation, not evidence. The family vocabulary comes
from the corpus and workspace, not a closed business taxonomy in engine code.

The provenance chain is `livrable → optional family/tag pivot → fiche → exact
fragment of raw/ingested`. Citation tokens are selected from the bounded
catalogue and materialized by the engine. `sources:` is derived from the
citation closure; anchoring, validation and the multi-source loss guard remain
deterministic engine responsibilities. Builds freeze the resolved evidence in
their per-build manifest. See `docs/provenance.md` for the data contracts.

The `/graph` page draws families and concepts from the generated family
folders and their citations to fiches; cross-cutting edges are computed from
shared citations, not stored as a second taxonomy. Retrieval, vector indexing, build, export and lint resolve a fiche as
the evidence-bearing page and a pivot as a navigation page. Stable/verified
pages are protected during automatic pivot regeneration. Re-ingesting a source
prunes only obsolete registry-owned generated pages for that source; it does
not purge the concept tree or unowned human pages.

The retired `concepts`, `reclassify-concepts`, `taxonomy`, and `group-concepts`
commands remain retired. Do not reintroduce a separate product step: section
extraction, fiche writes and tag-family projection are one approved,
workspace-locked operation. Section calls may be concurrent within the engine,
subject to the configured request limit; that internal concurrency is not a
second workflow.

## Workspace Skill Model

A workspace skill uses this layout:

```text
templates/
build-context/
.wiki/skills/
.wiki/system-prompt.md
CLAUDE.md
```

The fixed required directories are the package entry point; there is no root
manifest and no installer: the paths above are written directly in the
workspace. This is intentionally one-skill-per-workspace; do not add
multi-skill merging without redesigning the model.

The default scaffold includes small UI skills: `/status`, `/diagnose`, and the
production chain `/wiki-sync` (export all configured Confluence sources into
`raw/untracked/` — no source selection, no credential reconfiguration, and no
ingest) → `/wiki-ingest` (ingest what waits in `raw/untracked/`, whatever staged
it) → `/wiki-build` (build, optional template) → `/deliver` (export or polish,
optional deliverable + `polish` flag), with `/pipeline` as the one-shot
shortcut and `/wiki-rebuild` (re-file the archived sources into their concept
folders — `wiki ingest --from-ingested` — then run the content verification;
launched from the wiki row's history glyph in serve). `/curate` is the curation
entry point: it delegates `agent.curate` (the external runtime's confined-hands
capability — a reviewable branch, never a direct wiki write), and the empty
chat offers a **Curate the wiki** tile (`startCuration` in `chatHtml.ts`) that
selects agent mode before sending the same objective — a curation is an action,
so the read-only chat loop would only describe what it cannot do.

Scaffold skill bodies are **business intentions**, not procedures: they state
the outcome, the guardrails and the reporting, and never name an MCP server, a
tool or a job type. The manager's compiler turns a body into one delegable
intention per strong boundary, so the markdown shape is load-bearing — a body
written as a numbered list of phases becomes that many runs. **Every shipped
skill is a single intention**; only a user-authored body that opens a paragraph
on `Puis` / `Then` / `if available`… splits into a sequential chain. `pipeline`
in particular must stay a single intention: splitting it would take the
production capability's own DAG and concurrency away from it.

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
- `GET /api/runtime/workspace-stats` → runtime `/workspace/stats` (the
  workspace containers' summed `docker stats`, shown top-right in the Run
  execution canvas by `containerStatsScript.ts`, polled every 5 s only while
  that line is on screen; the legend sits bottom-right, the run's tokens in the
  graph toolbar)
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
- `POST /api/runtime/conversation/compact` → workspace-scoped runtime
  `/conversation/compact` (compact: mark everything said so far as forgotten
  for future turns without deleting the event log, and return the generated
  summary). Backs the composer's memory gauge. Same workspace-scoped,
  `409 run_active` shape as truncate.
- `GET`/`POST /api/runtime/control` → runtime `/control` (status/explain/enqueue
  while a run is active — see `llm-wiki-manager/CLAUDE.md`'s control lane
  section)
- `GET /api/config/profiles`, `POST /api/config/use` → runtime `/config/*`
  (`.wikirc` profile switching, described below)
- `GET /api/agent-proposals`, `GET /agent-proposals(/:id)` — the curation
  review surface (lot 1): proposals the manager persisted into
  `.wiki/agent-proposals/` from the gateway's worktree runs; the merge IS the
  approval. `POST /api/agent-proposals/:id/merge` writes the proposed pages
  through `applyWikiOperations` (adding OKF `verified` + `status: stable`),
  commits them to history, and removes the git worktree + branch;
  `POST /api/agent-proposals/:id/reject` removes the worktree and the proposal
  without touching the wiki. Both refuse with 409 `PRODUCTION_JOB_ACTIVE`
  only while a production job writes the wiki (`checkProductionAllowsWrite`,
  naming the job) — not during any of Donna's runs — and
  only `wiki/` paths are mergeable — the proposal travels from another
  process and is treated as untrusted. See `src/serve/routes/agentProposalRoutes.ts`.
  The page is readable: records read as summaries ("N wiki pages · labels ·
  N new/updated/removed"), files are named by label with New/Updated/Removed,
  the justification is rendered Markdown (links and `<br>` only, everything
  else escaped), the diff is coloured line by line, and id/branch/created
  travel under a collapsed "Technical details". A "Start a curation" button
  (revealed once embedded in the shell) confirms, then posts `llmwiki:curate`;
  the shell's `startCuration()` (`src/chat/chatHtml.ts`) selects agent mode and
  submits the canonical objective as a Donna turn — the page never calls the
  runtime. `src/serve/html/reviewShortcutScript.ts` keeps the sidebar's Agent
  proposals link marked active exactly while its page is displayed.

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

`sendRuntimeAgentMessage` always posts to `/api/runtime/turn` (chat AND agent
mode): the runtime itself classifies agent-mode messages sent while a run is
active — control verbs and new tasks go to the control lane, plain
conversation is answered read-only (no more choice menu blocking the
composer). A 409 fallback to `/control` remains for the idle→busy race, and
the runtime's `explanation` is shown for the `observe`/`converse`/`mutate`/
`enqueue` classification — see `llm-wiki-manager/CLAUDE.md`'s control lane
section for what each classification means. This is the same classifier the
ShellTUI uses; do not add a second one here.

Replies are rendered from `/state`, never from the SSE payloads: while an
answer is awaited, a gentle poll (2.5 s) keeps merging the conversation even
when the stream dies — a silent SSE break no longer leaves an answer visible
in the ShellUI but never in serve.

`window.__WIKI_CONFIG__.runtime.enabled` is `true` when `WIKI_MANAGER_RUNTIME_URL`
is set; chatHtml uses this to show/hide the Agent mode toggle.

Both Chat and Agent mode send `context.openWikiPages` through `/api/runtime/turn`. The
browser keeps at most five distinct Markdown paths selected from `wiki/` or
`raw/untracked/`; opening a wiki page or successfully converting an upload adds
its path. An OS file drag onto the chat routes to the same upload flow as the
paperclip button (`initPageContextDrop` in `wikiPanelScript.ts`); only wiki
graph items travel as the custom context MIME. These are references only:
never read or inline document content in the browser or proxy. Donna receives
the sanitized paths in its prompt and must use its allow-listed read tools. The
MCP `wiki_read_page`/`wiki_read_pages`
tools therefore allow `wiki/`, `raw/ingested/`, and `raw/untracked/`, while the
shared workspace-root/path-traversal guard remains authoritative.

The selection is part of the conversation: it travels in the payload saved
with the history (`pageContexts`, restored by `resetPageContexts` on load), and
"+ Context" on a wiki page opens the split view so the document and the chat
are visible together. A graph closed from its own toolbar hands the centre
back to the page it replaced.

**TOTP login gate** (`src/serve/routes/loginRoutes.ts`): when
`WIKI_MANAGER_RUNTIME_URL` is set and the runtime's `/login/status` reports
`enabled: true` (cached 60 s), every request except `/login`, `/api/login` and
`/api/logout` must carry a valid `wiki_session` cookie — validated against the
runtime's `/session/verify` with the manager bearer (30 s memo), never
verified locally. The TOTP secret never reaches serve. Without a session:
browsers get a 302 to `/login`, API/fetch get 401. Runtime unreachable: fail
**closed** with a clear "session service unavailable" page. The login page
(`src/serve/html/loginPage.ts`, re-exported by `loginRoutes.ts`) is also the
product's front door: what wikiLLM does, what opens after signing in, and a
public status block (session service reachable, version, up since, enrollment,
session lifetime, TLS) fed by the runtime's `/login/status` — only those public
facts, never a workspace, a run, an agent or a path. The page sends the
6-digit code to the runtime's `/login/verify` through
`/api/login`; `/api/logout` revokes and clears the cookie. Standalone serve
(no runtime URL) stays open; the whole gate is skipped then. See
`help-doc/13-login-totp.md`, `docs/configuration.md` § serve, and the
manager's login modules.

## Serve — what must survive a change of centre view

The shell has four centre views (chat, wiki, connectors, execution) and hides
`#input-wrap` in three of them. Anything the workspace demands of its reader must
therefore live **outside** that block:

- `#approval-banner` is a fixed overlay, a sibling of `#main`, not a child. Inside
  the composer it was invisible exactly where it mattered — a restore launched
  from `/history` waited on an approval nobody could see. It is kept out of
  `#main` too: `#main` is a flex column normally and an explicitly-placed grid in
  split mode, so a new child there needs a placement in both.
- The `/graph` page reads ONE payload, `/api/graph/taxo` (`taxoGraph.ts`):
  concept pivots with their `family`, the fiches under `wiki/sources/`, the
  concept→fiche `[src: …]` links and the settled positions of the three force
  views, cached on the same file etag. Co-citation, shared-source family links
  and membership are derived in the browser (`taxoStateScript.ts`), exactly as
  the TAXO prototype did. A click on a fiche opens the context card
  (`contextCardScript.ts`: LLM summary, preview, "Add to Donna"); summary and
  preview accept any node the TAXO payload draws. The family/source filters of
  the left column govern what is drawn and framed (the single `visible()`
  predicate); the inspector keeps listing a node's full neighbourhood.
- The graph search is the **engine's retrieval**, not a second matcher:
  `/api/graph/search` → `createGraphSearch` (`src/serve/graphSearch.ts`) →
  `RetrievalService.search` (hybrid BM25 + vectors when the index exists),
  reranked by the configured reranker because the fused scores are flat, then
  cut at half the best score (max 25). When the reranker scores every hit
  under 0.05 (nothing relevant), the 5 best fused hits come back flagged
  `weak` instead of lighting the whole graph. The answer names its mode and the
  page shows it — a spinner in the field while the engine answers, then a chip
  (`semantic + lexical`, or amber `lexical only` / `weak matches`): a
  `lexical-fallback` is announced, never passed off as semantic.
  Without the injected search the route answers 503. The old relation filter
  (`queryFilter.ts`, `?q=` on `/api/graph/overview`) still serves the MCP and
  list routes, not this page.
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

- **Approval card** (`#approval-banner`, `chatView.ts`/`chatHtml.ts`): amber
  card with the text on top and Approve/Reject underneath, shown whenever
  `runtimeState.approvals` or a plan task is `pending_approval`. Approve →
  `POST /api/runtime/approve {scope:'run'}`; Reject cancels the run. It lives
  in `#workspace-dock` (`maintenancePanelScript.ts`): a fixed card stack at the
  bottom right, beside the 40 px rail, the Activity panel's width (`--dock-w`,
  published on the root by the panel's splitter), height fitted to its content,
  that survives every view. Maintenance notices are the dock's other card.
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
  Node labels are theme-aware (`#172433` in the light theme, `#f7faff` in the
  dark) — a fixed light fill made them invisible on the light canvas
  (`runtimeCanvasScript.ts`).

The Activity list is split into `Plan`, `Files`, and `Logs`. Plan carries the
run: tasks, queue, the aggregated **business** activity lines
(`workflow.activity.lines`, never a raw tool id) and the skill chain
(`skillChains`), so a Plan tab alone holds the outcome — including the steps a
chain skipped. Files is the local upload/conversion feed (former "Direct
agents"); Logs keeps the essential run events plus the `assistant_progress`
notes, prefixed `Agent:` like the ShellUI's Agent status tab. The former
`Chain` and `Runtime activity` tabs were removed — they only duplicated Plan.
Each tab owns a `Clear` action; `Clear all` beside the List/Graph switch applies
all three. Local clearing removes browser-owned upload/MCP cards, while clearing
the other tabs hides the current runtime snapshot until new state changes its
fingerprint. This is deliberately not a runtime deletion. `Reset plan`, shown
only in the Plan tab, requires browser confirmation and calls
`/api/runtime/reset`; it stops active work and purges the workspace runtime
plan, activities, logs, queue, and persisted projection. Upload cards with an
`error` always render as failed even if storage succeeded.

There is no floating run strip and no bottom status bar any more (both
removed after 0.16.51): the run reads in Activity → Plan only. The run card at
the top of the panel (`runtimeRunCardHTML`) carries the percentage, the elapsed
time and the gateway heartbeat (`alive Ns ago`, `#run-beat`, filled in place by
`updateRunElapsed` so the per-second tick never resets scroll), with Inspect and
a red Cancel (`.act-btn.cancel`) that confirms, then `POST /api/runtime/cancel`
— chain-scoped, and the runtime also sends `agent_cancel` to the jobs of a
re-attached run. `runStripScript.ts` keeps only the shared formatting
(`runStripDetail`, the ShellUI's `activityDetailText` port) and the Cancel
actions. The `assistant_progress` notes never enter the thread as messages: they
feed the Logs tab and the ephemeral waiting bubble, which shows
the turn's LAST step only, replaced at each event until "Writing the answer…".
That line — the turn bubble and a run's live line alike — is an allow-list
(`src/chat/runtime/progressLabelScript.ts`): wiki search, a tool with its main
arguments, `Thinking… Ns` while a model call runs, the answer being written and
the failures that change it; the model meter, raw traces and the loop counter
stay in Logs. An event of another conversation never updates the bubble or the
live line of the chat on screen.

While a dropped PDF/text file waits on the documents agent, the Pending panel
shows it as a **non-clickable spinner row**: the server renders it from the
upload manifest (`readInFlightDocumentUploads` in
`src/serve/routes/uploadRoutes.ts` — only `converting` and error-less `stored`
records fresh enough not to be a crash leftover), and the sidebar drop handler
adds an optimistic copy the moment the POST leaves (`addPendingUploadRow` in
`wikiLayoutScript.ts`). A failed conversion is terminal for the panel: the
record leaves the in-flight filter, the optimistic row is removed and the
refresh reconciles — the file disappears from Pending, while the chat Activity
card keeps its `Retry` (the manifest record survives).

**Conversation compact** (`compactConversationMemory`, `#memory-gauge-btn`):
the composer ring counts only the visible thread since the last compact
(`gaugedConversationCount`, threshold 40) — purely cosmetic, it truncates or
refuses nothing. Compacting **keeps the same conversation**: it marks the
boundary, persists it as `compactedCount` on the conversation payload
(`buildConversationPayload`/`loadConversation`) and resets the gauge, so the
messages stay on screen and the tooltip reads `compacted (thread kept)`.
Runtime side, `conversation_reset` sets `conversationSeedStart` — the displayed
thread is kept everywhere, only what Donna is told resets — and
`conversationSeed` slices from that boundary.

**Sidebar launch buttons** (`wireSidebarLaunchButtons` in
`src/serve/html/wikiLayoutScript.ts`): Pending's Ingest and the wiki row's
Rebuild-from-the-archive button are server-rendered hidden and revealed here.
The function is defined at **script scope**, not inside either IIFE that calls
it (`refreshSidebar` and `initShellMessaging`): nested inside one, the other
threw `ReferenceError` and the button stayed hidden. Rebuild posts the
`llmwiki:rebuild` message, which routes `/wiki-rebuild` through Donna to the
production `knowledge.rebuild` capability — `wiki ingest --from-ingested` plus
`lint` in ONE job, never build/export/polish (a fuzzy match otherwise picked
`document.build`). In the tree, the wiki root reads `WIKI` and the reserved
`Answers`/`Concepts`/`Sources` folders take a leading capital (`navNodeLabel`
in `wikiHtml.ts`); the embedded Explorer panel is scaled to the shell chrome by
`html.sidebar-panel { font-size: 13.5px }` (`wikiLayoutCss.ts`). A plain root
(the wiki root, a collection) wraps its label and actions in one
`side-folder-plain-head` row, so the primary row's `--accent-soft` background
runs the whole title line — under the right-aligned rebuild button — instead of
stopping at the label. Label and actions must stay in that head row.

**Shell-only page actions** (`src/serve/html/pageActionsScript.ts`): a wiki
content page opened in the chat shell's centre frame reports its navigation
and reveals/wires Close, + Context, Build, Export/polish, Reformat and Start a
curation; each launch confirms, then posts its `llmwiki:*` message to the
shell, which owns the Donna turn. Extracted from `wikiLayoutScript.ts` to hold
its size ceiling; the wiki-page launches themselves live in
`src/chat/views/wikiAgentLaunchScript.ts` (`handleWikiAgentLaunch`). A
not-found page embeds `llmwiki:notfound`: the shell forgets a remembered wiki
path that no longer exists and opens Home instead of freezing on "Document not
found" — only while the dead page is still the centre's target, so a late
message cannot yank the reader elsewhere. Standalone pages keep their
Back/Home buttons, and the wiki graph's TAXO views are documented under
`src/graph/wiki/taxoGraph.ts`.

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

The Plan tab renders the **skill chain** from `runtimeState.skillChains`, the
projection the runtime publishes over the control queue, with one line per step
(`✓ ● × –`), its status and its `skipReason`. A chain disappears once it is
fully `done`; it stays visible when it was cancelled or left incomplete, which
is exactly when the user needs to see which steps were skipped. Styles live in
`styles/chatActivityStyles.ts` under `.chain-*`.

The empty chat's first tile and the empty Activity panel's button both open
the Help panel (`toggleHelpPanel()`) — a slide-out reader over the bundled,
global `help-doc/` chapters (`src/utils/helpDoc.ts`), also reachable at
`/help`/`/help/:id` and through the `help_list`/`help_read` MCP tools. This is
static, workspace-independent documentation, not a workspace skill: it never
auto-starts and has no per-workspace customization (unlike `.wiki/skills/`
entries, which are per-workspace and live under `.wiki/skills/`).

Documentation has three trees with three readers: `help-doc/` is shipped and
read at runtime by the **user**; each repo's `docs/` is repo-only and read by
whoever **changes or deploys** that code. Write a fact once, in the tree whose
reader needs it, and link from the other. The full ownership table is in the
wikiLLM root `CLAUDE.md`, § "Where a documented fact belongs".

The skill list in `help-doc/08-commands-serve.md` is **generated** from
`scaffold/workspace/.wiki/skills/` by `scripts/generate-help-skills.js`, between
its two markers — do not hand-edit it, run `npm run generate:help-skills`. Prose
outside the markers stays authored. `npm run check-help-skills` fails on drift
and `tests/help-doc-skills.test.ts` runs that same check: the help advertised
six skills for a while after the concepts rework shipped eleven, and nothing
caught it. A skill's `description` is therefore read by two audiences — the
help, and the catalog the model selects from — so write it for a user.

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
- `workspaceService.ts`: path safety, workspace IO.
- `ingestService.ts`: source-to-wiki LLM pipeline. `--dry-run` (`wiki
ingest`) builds a review per planned operation (`buildReviewOperations`):
  before/after existence, SHA-256 hashes, and a compact unified-diff preview
  (`diffPreview`, capped at 12 lines), without writing. `--reject <path...>`
  drops one or more planned operations before applying; if every operation
  for a source is rejected, the source is not archived (`ingest:apply-skip`
  is logged, distinct from a genuinely empty plan, which still archives).
  When the provenance contract (not the reader's `--reject`) refused every
  fiche, the source is reported **failed** (`ingest:source-failed`, the job
  exits 1), never `source-done success`: it stays in `raw/untracked/`. Line
  anchors are checked against the archive exactly as written (`rawContent`),
  never the trimmed body — the one-line shift stripped every valid
  `#L…@sha256` anchor of a source opening on a blank line.
  Section titles are normalised deterministically before they reach a fiche's
  `title:`, file name and subject (`utils/pageTitle.ts`'s `stripTitleMarkup`):
  a Confluence export's `# **5.5.Vue physique**` becomes `Vue physique`, so the
  tree never shows the emphasis or the outline number. Already-ingested pages
  keep their old titles until a rebuild (`wiki ingest --from-ingested`).
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
  `mcpServer.ts`, and was consolidated). The old consolidation inventory and
  its lenient label matcher (`subjectsAreRelated` / `subjectMatchInventory`)
  were retired with the pre-TAXO pipeline. `detectConceptSplits`
  (`consolidationValidate.ts`) is the remaining split check and compares only
  exact normalized subjects, or a shared verified `subject_id`: a split
  DECLARES a duplicate, costs retry rounds and tells the model to merge, so
  `jedox-cloud` and `anaplan-cloud` must stay two products.
- A leaf's first `generated` and its human review trail are **carried at write
  time**; its `sources` is **derived**. `applyWikiOperationsAtomic` first merges
  the existing file's engine-owned frontmatter (`carryForwardEngineFrontmatter`,
  `okf/frontmatter.ts`) — the operation content is the model's output for one
  source and never contains what earlier ingests accumulated — then, for
  `wiki/concepts/**` and `wiki/sources/**`, `applyDerivedSources`
  (`provenance/write.ts`) recomputes `sources` from the body's citation closure
  and overwrites the unioned list. The HUMAN review trail is the exception:
  `verified` attests one TEXT and `status: stable` vouches for it, so when the
  ingest rewrites the body they do not survive — the trail is dropped and a
  `stable` page returns to `draft`. An idempotent re-apply (identical body) keeps
  both. Carrying them across a rewrite left pages asserting human verification
  for content nobody reviewed. `validateConsolidation` also turns a concept
  `create` into an `update` when the path already exists, keeping it out of the
  concept budget.
- `enforceSourceCitationPath` **preserves** a citation already anchored to an
  archived source (`raw/ingested/…`, well-formed) or a workspace page: on an
  update the model keeps the page's earlier citations, and rewriting those to
  the source being ingested misattributed the facts they back to it. Only the
  pending form (`raw/untracked/…`) and a malformed/relative path are normalized
  to the current archive path. That is what made "the sources associated are
  often not the right ones" possible. The well-formedness test applies to the
  PATH alone, never to `path#Section`: a heading carries spaces and apostrophes
  by nature, and testing the whole citation rejected every real anchored
  citation — destroying the anchor and reattributing the claim. The anchor
  rides along on both branches.
- `wiki ingest --from-ingested` **rebuilds the concept tree from scratch.** A
  full rebuild (no input paths) deletes EVERY leaf under `wiki/concepts/`
  before re-filing the archive (`purgeConceptTreeForRebuild` →
  `listConceptLeafPaths`, logged `ingest:rebuild-purge`), then the command's
  normal end-of-run vector index rebuild reindexes the new content. Pruning only
  the leaves the run no longer produces was not enough: the model, shown the
  existing pages, may keep an old projection AND add a new one, so the
  accumulated set only grew — concepts and leaves doubled on every rebuild.
  The purge owns the `wiki/concepts/` subtree, including pages a human wrote
  there; it stops at the section root (the empty `concepts/` folder survives).
  A partial rebuild (input paths given) keeps the rest of the tree and the
  stale-leaf safety net (`staleRebuiltLeaves`): a leaf the rebuilt sources no
  longer produce, that no other source claims, is deleted after a failure-free
  run (`ingest:rebuild-prune`), while a partial failure prunes nothing
  (`ingest:rebuild-prune-skipped`).
- `buildService.ts`: template slot batching and generation. Build context is
  **fiches first**: it searches `wiki/sources/` with the same hybrid retrieval
  as everything else (there is no `buildStrategy` any more — the vector index
  exists to rank this context; `doctor` announces and `--apply` removes a
  leftover key) and no per-slot rerank. An archived original enters only when
  no fiche covers a slot, logged `build:raw-fallback`: citing it directly
  skipped the consolidation and let one long source answer a question several
  sources cover. `capPerDocument` keeps at most 3 pages of one document
  (a fiche's document is its folder) in a slot's context. The provenance still
  reaches the archive through the fiche's anchored citation, frozen by the
  build's evidence manifest.
- `refreshService.ts`: stale deliverable detection.
- `exportService.ts`: citation expansion and polish. A section's evidence is
  first the frozen fragment text from the build's evidence manifest
  (`.wiki/builds/<buildId>/evidence.json`, selected by the deliverable's
  `evidence_build_id` or `--evidence-build`; a missing manifest is logged
  `export:evidence-missing` and falls back to live reads). A live read narrows
  an anchored citation to its cited sections (`sliceCitedSection`); only an
  un-anchored citation — or an anchor matching no heading, announced as a
  warning — reads the source whole (bounded by `maxSourceChars`), replacing its
  chunk fragments. The "insufficient source documentation" note only appears
  when the evidence genuinely lacks the detail. The final export passes through
  `stripCitationMarkers`, so a section kept unchanged (unresolved source or
  failed validation) cannot leak its `[src: …]` markers into the output.
  A versioned copy is kept only when the output ALREADY exists: the first run
  leaves a single `<name>.export.md`, a later run archives the PREVIOUS content
  as `<name>_v-YY.export.md` (or `.export.polished.md`) before overwriting
  (`exportVersionParts`/`versionedExportPath`/`nextExportVersionNumber`, wired
  in `commands/export.ts`). YY is two-digit per kind series — exports and
  polishes number independently, a custom `--output` or a version-of-a-version
  is never versioned, and the versioned path joins the same history commit
  scope as the output. `polish` is the second step of the `export → polish`
  chain: an export artifact carries no `[src:]` marker left
  (`stripCitationMarkers`), so it takes `expandDeliverable`'s polish-only pass
  and writes `<name>.export.polished.md` without re-exporting; only an
  already-polished artifact is refused, naming its export.
  `exportArtifactTargetError` refuses an artifact as EXPORT input and names the
  source deliverable — re-running the expansion on its own output wrote the
  artifact onto itself. The serve export/polish button is still not offered on
  an `*.export(\.polished)?\.md` artifact.
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
- `mcpServer.ts`: wiki MCP tools — reads (`wiki_read_page(s)` now carry the
  page's `citations`/`links` structurally, so callers follow provenance
  without re-parsing markdown), the queryable graph (`wiki_graph_query` /
  `wiki_graph_path` over `src/graph/wiki/queryGraph.ts` — the materialized
  adjacency incl. the transverse `shared_subject` edge and, for TAXO fiche↔tag
  pivots, `co_cited` (`shared_tag` no longer forms a clique between fiches), rebuilt
  per call), templates (listing carries frontmatter titles; a missing path
  falls back to the basename search before refusing) and deliverables (same
  title treatment).

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
- **OKF frontmatter.** Every new write point that produces a `.md` file **in the
  bundle** (`wiki/**` and `deliverables/**`) must give it an OKF `type` — either
  through `applyProvenance(…, type)` (provenance pages) or
  `applyOkfFrontmatter` (`src/okf/frontmatter.ts`). The `type` vocabulary is
  closed in `okfTypeForPath`; `wiki doctor` (and `--apply`) list/write the
  missing ones, and `lint` reports `pagesMissingOkfType`.

  OKF v0.2 keys are additive everywhere, never overwriting a hand-set value:
  ingest writes `generated {by, at}` + `status: draft`, and `sources` is
  derived from the body's citation closure (`provenance/write.ts`), not stamped
  or unioned;
  the agent-proposals merge writes `verified` + `status: stable`. `wiki doctor
  --apply` also runs the v0.2 catch-up (`timestamp` → `generated`, a trailing
  `## Citations` section → `sources`, missing `status` → `draft`) — one line
  per file, idempotent, never during an ingest run (`src/okf/scan.ts`).
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
- **Direct writes during a production job** (`checkProductionAllowsWrite`,
  `src/services/productionLocks.ts`): the guard reads the agent's lock files
  AND what each active job does (its `type` and step names). A
  `wiki_write_page` is refused while a job writes the wiki (ingest,
  ingest_rebuild, restore, doctor_apply, pipeline, copy) — it
  used to be refused by nothing, so a page could be written in the middle of
  `ingest`. `template_write`/`build_context_write` are refused only
  while a job builds from them (build, pipeline, restore) — the former "any
  active job" rule also refused a template written during a plain ingest. A
  lock whose job record is not flushed yet still refuses both. Refusals return
  `PRODUCTION_JOB_ACTIVE` with the job and its operations, and are audited
  `rejected_production_busy`; the preview path is never guarded.
- Preserve MCP bearer-token behavior: browser clients must not receive
  workspace MCP tokens.
- Keep Docker one-shot CLI usage separate from long-running `serve`.
- There is no skill installer: `.wiki/skills/` is written directly (operator
  copy, scaffold or workspace method). Do not reintroduce a fetch-and-extract
  path or a skill registry.

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
pnpm dev build --plan
```

Runtime image note: `dist/bin/wiki.js` imports runtime dependencies and `serve`
resolves browser assets from `node_modules`. `EXPOSE 3000` does not start
`wiki serve`; Compose must run the desired command explicitly.
