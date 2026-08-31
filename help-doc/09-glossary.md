# Glossary

The application's vocabulary, in plain terms. Terms are grouped by theme.

## Spaces and content

- **Workspace** — an isolated working space, with its own sources, wiki and
  deliverables. Multiple workspaces are sealed from one another. `/use` selects
  the active one (Shell).
- **Source** — an input document: Confluence page, uploaded file, converted
  document. The raw material of the wiki.
- **Conversion** — turning a non-Markdown document into Markdown (extraction,
  OCR) before ingestion.
- **raw/untracked** — the working area where converted Markdown lands, reviewable
  before integration.

## The wiki

- **Ingestion (ingest)** — the operation that reads the sources and extracts wiki
  pages. Done as a dry-run (*plan*) then an apply.
- **Dry-run** — a simulated ingestion: the plan of pages, without writing
  anything.
- **Rejected page** — a page an ingestion sets aside (irrelevant or redundant).
- **Wiki** — the set of durable knowledge pages produced by ingestion.
- **Concept** — the folder a knowledge page is filed under, naming a piece of
  reusable knowledge (a system, an actor, a rule, an architecture) rather than a
  raw document. One leaf per (concept × subject) lives at
  `wiki/concepts/<concept>/<subject>.md`: the concept **is** the folder,
  produced by the ingestion itself. There is no separate step that builds,
  rebuilds or reclassifies it — re-running an ingestion is how concepts change.
- **Unclassified** — a leaf that fits no concept folder yet; it waits under
  the reserved `wiki/concepts/unclassified` folder until someone files it by
  hand.
- **Taxonomy** — the classification of the wiki used by the `/graph` view and
  by navigation. It is derived from the concept folders themselves — there is
  no separate step to publish it.
- **Source note** — a page that traces the origin of a piece of information.
- **Index** — the canonical map that links and references the wiki's pages.
- **Log** — the chronological journal of ingestions and updates.
- **Semantic search** — search by meaning (not just keyword), backed by a vector
  index of the wiki.

## Production

- **Template** — the frame of a deliverable, which DONNA fills with the wiki's
  knowledge.
- **Deliverable** — a finished document produced from a template and the wiki.
- **Build** — regeneration of the deliverables from the templates and the wiki.
- **Export** — producing outputs to the outside (final files, exporting a
  Confluence space to Markdown…).
- **Polish** — improving the form of existing content.
- **Doctor** — diagnosis of the workspace state.
- **Pipeline** — a chain of several production steps, run identically from the
  Shell or Serve as the `/pipeline` skill.

## Interaction

- **Chat mode** — DONNA reads and answers, read-only. See
  `04-interaction-modes.md`.
- **Agent mode** — DONNA orchestrates actions (import, ingest, build, export).
  See `04-interaction-modes.md`.
- **Shell** — the terminal cockpit (`wiki-manager`), driven by commands. Its
  command reference is `07-commands-shell.md`.
- **Serve** — the web interface of a workspace (chat, Activity, wiki browser).
  What you can do there is in `08-commands-serve.md`.
- **Graph** — the visual view of the wiki (page `/graph`) and the Graph view of
  the Activity panel.
- **Activity** — the panel that shows processing live and its progress (Serve).

## Orchestration

- **Agent** — a specialized service DONNA hands a task to (production, document
  conversion, Confluence export…).
- **Capability** — what an agent can do. You state a goal, DONNA resolves the
  required capability and routes the task — without you naming the agent.
- **Orchestration** — DONNA's coordination of tasks across agents. Agents never
  talk to each other directly.
- **Approval** — consent requested at sensitive steps of a job, bounded per run
  (`/approve`, usable from either interface).
- **Idempotence** — the property that guarantees re-running an action does not
  duplicate work already done.
- **Runtime** — the component that executes and tracks agent-mode actions. If it
  is unavailable, chat stays usable.
- **Agentic runtime** — an external analysis engine DONNA can delegate open
  questions to (audit, synthesis, web research). It reads, reasons and
  proposes — but never modifies the workspace itself: its side-effects go
  through approval, and its proposals enter the plan like any other job. See
  `12-agentic-runtime.md`.
- **Parallelism** — the number of independent tasks that may run at the same
  time, subject to agent limits, plan limits and resource locks.
- **Collection concurrency** — the parallelism used when connectors collect
  data from external services.

## Configuration

- **LLM** — the language model that powers DONNA's reasoning; an OpenAI-compatible
  endpoint you configure (Base URL, model, optional key).
- **Embeddings** — vectors that power the wiki's semantic search.
- **Connector (MCP)** — an external integration (Confluence, documents…)
  exposed to DONNA. `/mcp status` (Shell) or the Connectors panel (Serve)
  gives its state.
- **/status** — the deterministic command that sums up the active workspace,
  configuration, MCP connectors, sources, content, deliverables and agent
  concurrency. Works identically in the Shell and in Serve.
