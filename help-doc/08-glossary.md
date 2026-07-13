# Glossary

The application's vocabulary, in plain terms. Terms are grouped by theme.

## Spaces and content

- **Workspace** — an isolated working space, with its own sources, wiki and
  deliverables. Multiple workspaces are sealed from one another. `/use` selects
  the active one.
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
- **Concept** — a page carrying reusable knowledge (system, actor, rule,
  architecture) rather than a raw document.
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
- **Pipeline** — a chain of several production steps.

## Interaction

- **Chat mode** — DONNA reads and answers, read-only. See
  `04-interaction-modes.md`.
- **Agent mode** — DONNA orchestrates actions (import, ingest, build, export).
  See `04-interaction-modes.md`.
- **Shell** — the terminal cockpit (`wiki-manager`), driven by commands.
- **Serve** — the web interface of a workspace (chat, Activity, wiki browser).
- **Graph** — the visual view of the wiki (page `/graph`) and the Graph view of
  the Activity panel.
- **Activity** — the panel that shows processing live and its progress.

## Orchestration

- **Agent** — a specialized service DONNA hands a task to (production, document
  conversion, Confluence export, mailer…).
- **Capability** — what an agent can do. You state a goal, DONNA resolves the
  required capability and routes the task — without you naming the agent.
- **Orchestration** — DONNA's coordination of tasks across agents. Agents never
  talk to each other directly.
- **Approval** — consent requested at sensitive steps of a job, bounded per run
  (`/approve`).
- **Idempotence** — the property that guarantees re-running an action does not
  duplicate work already done.
- **Runtime** — the component that executes and tracks agent-mode actions. If it
  is unavailable, chat stays usable.

## Configuration

- **LLM** — the language model that powers DONNA's reasoning; an OpenAI-compatible
  endpoint you configure (Base URL, model, optional key).
- **Embeddings** — vectors that power the wiki's semantic search.
- **Connector (MCP)** — an external integration (Confluence, documents, mailer…)
  exposed to DONNA. `/mcp status` gives its state.
- **/status** — the command that sums things up: LLM, connectors, sources,
  content, deliverables.
