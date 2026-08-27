# Actions in Serve (the web interface)

Serve does not have a command cheatsheet the way the Shell does: most of what
you can do is either a **panel you click**, or a small set of commands typed
straight into the chat composer. Both are covered here. Infrastructure
administration (starting containers, managing workspaces, raw connector
status) is Shell-only — see `07-commands-shell.md`.

## Commands you can type in the composer

These work exactly the same, character for character, whether you type them
in Serve's chat or in the Shell:

- `/status` — sum up the workspace: LLM, connectors, sources, content,
  deliverables. **The first command to run when in doubt.**
- `/agent` — switch to agent mode (orchestration: actions and processing).
- `/chat` — switch to chat mode (read-only: questions, state).
- `/approve` — grant a pending approval (sensitive step of a job).
- `/run status` — state of the runtime and the current run.
- `/run cancel` (or `/cancel`) — cancel the active run.
- `/queue` — show the job queue.
- `/queue cancel <id>` — cancel a queued or running job.

## Production skills

Workspace skills run identically from Serve or the Shell — the runtime reads
and compiles the skill, not the interface you typed it into. Type the name
directly (`/pipeline`) or `/skills run <name> [arguments]`. A name in brackets
is an optional argument; leaving it out means "everything in scope".

The list below is generated from the shipped skills themselves, so it can never
fall behind them:

<!-- BEGIN GENERATED SKILLS -- run `npm run generate:help-skills`, do not edit by hand -->

- `/deliver [deliverable] [polish]` — publish existing deliverables, with or without polishing.
- `/diagnose` — diagnose workspace configuration and prioritize concrete remedies.
- `/new-template [family] [intent]` — author one instruction-only deliverable template — never build, export or publish it.
- `/pipeline` — run the whole production chain in one go, from ingest to polish.
- `/status` — summarize connector health and current or recent jobs.
- `/wiki-build [template]` — build deliverables from the current wiki for one template or all templates.
- `/wiki-ingest [files]` — ingest Markdown already waiting in raw/untracked, then refresh the concept grid and taxonomy.
- `/wiki-rebuild-concepts` — rebuild the concept grid, file unclassified pages into it, and republish the graph taxonomy.
- `/wiki-reclassify` — file unclassified concept pages into the existing grid, then republish the taxonomy.
- `/wiki-sync [source]` — export Confluence sources and then ingest the exported Markdown.
- `/wiki-taxonomy` — republish the graph taxonomy from the current wiki content.

<!-- END GENERATED SKILLS -->

`/status` and `/diagnose` are read-only. Every other skill mutates the
workspace and asks for approval before it does.

For the knowledge lifecycle, three of them are partial reruns of the same
chain, from the widest to the narrowest: `/wiki-rebuild-concepts` resynthesizes
the concept grid, refiles what sits unclassified and republishes the taxonomy;
`/wiki-reclassify` skips the grid rebuild; `/wiki-taxonomy` republishes the
taxonomy alone. `/wiki-ingest` already ends with the first of the three, so
running one of them right after an ingest repeats work that has just been done.

You can also describe the goal in ordinary language — "run the deliver skill
with the quarterly template" — instead of typing the command. See
`04-interaction-modes.md`.

## What's a panel, not a command

Everything below is a **UI panel**, not something you type:

- **Connectors panel** — add, edit, remove, and reconnect MCP servers; this is
  Serve's equivalent of the Shell's `/mcp status`/`/mcp endpoints`. It also has
  a visual **skill editor** (create, edit, save a workspace skill) — the
  equivalent of the Shell's `/skills edit`.
- **Upload button** — attach a document to the conversation; the equivalent of
  the Shell's `/upload <path>`.
- **Pending panel** (wiki browser) — the inbox of sources, `raw/untracked/`.
  Drop files on it from your desktop: Markdown is written as is, and PDF or
  text files are converted to Markdown first. That conversion is done by the
  documents agent, so those two formats are accepted **only while that agent is
  running** — when it is down or not configured, the panel says so and takes
  Markdown only. Each conversion appears in the **Activity panel** as it runs,
  one file at a time, exactly like a conversion started from the Upload button;
  the panel fills in as each file lands. Dropping while a run is in progress is
  allowed: a file that arrives after the run listed what was pending simply
  waits for the next ingestion. Its lightning button starts the ingestion of
  everything pending.
- **Activity panel** — live tracking of runs, with *List* and *Graph* views.
  Each of its five tabs (Plan, Chain, Local activity, Runtime activity, Logs)
  has its own `Clear`; `Clear all` clears all five. `Reset plan` (Plan tab
  only) stops active work and purges the run — ask for confirmation first.
- **Execution view** — the same Run/Task graph as the Activity panel's *Graph*
  view, opened full-page.
- **Redo** — on a past message, truncates the conversation back to that point.
- **LLM settings** (sidebar) — Base URL, Model, API key, and the active
  `.wikirc` profile picker.
- **Help panel** — this documentation, read in place, without leaving the chat.
- **Page `/graph`** — the visual map of the wiki.

## Notes

- A product or status question remains answerable in chat. A mutating action
  (ingest, build, export, configure) requires agent mode and an available
  runtime.
- When blocked, `/status` is the first diagnostic reflex; if it points at a
  services or infrastructure problem, see `06-troubleshooting.md` and, if you
  have terminal access, `07-commands-shell.md`.
