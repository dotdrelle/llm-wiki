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
- `/remember <fact>` — explicitly save a durable fact for this workspace across
  conversations. `/memory` lists saved facts; `/memory history <key>` shows
  versions; `/memory restore <key> <history-id>` restores one; `/forget <key>`
  removes a fact. These are requests to Donna: the composer switches to agent
  mode, she performs them with her memory tools and answers in your language
  (the runtime must be connected). Activity → Memory provides the same inspect, forget and
  restore controls. Donna may also extract durable facts from user messages;
  credential-shaped messages are skipped, and each stored fact can be removed
  or restored. Automatic extraction can be disabled by the workspace operator.
  Facts remain until forgotten or the workspace is deleted.
  Facts never cross workspace boundaries. Conversation threads remain separate;
  Donna searches another thread only when you refer to a previous discussion.

## Production skills

Workspace skills run identically from Serve or the Shell — the runtime reads
and compiles the skill, not the interface you typed it into. Type the name
directly (`/pipeline`) or `/skills run <name> [arguments]`. A name in brackets
is an optional argument; leaving it out means "everything in scope".

The list below is generated from the shipped skills themselves, so it can never
fall behind them:

<!-- BEGIN GENERATED SKILLS -- run `npm run generate:help-skills`, do not edit by hand -->

- `/curate` — curate the wiki — find duplicate, disagreeing, outdated or unsourced pages and propose corrections on a branch a human merges or discards.
- `/deliver [deliverable] [polish]` — publish existing deliverables, with or without polishing.
- `/diagnose` — diagnose workspace configuration and prioritize concrete remedies.
- `/new-template [family] [intent]` — author one instruction-only deliverable template — never build, export or publish it.
- `/pipeline` — run the whole production chain in one go, from ingest to polish.
- `/status` — summarize connector health and current or recent jobs.
- `/wiki-build [template]` — build deliverables from the current wiki for one template or all templates.
- `/wiki-ingest [files]` — ingest Markdown already waiting in raw/untracked into the wiki.
- `/wiki-rebuild` — rebuild TAXO fiches and tag-family pivots from archived sources, then verify links and OKF frontmatter.
- `/wiki-sync` — export all configured Confluence sources into the pending inbox.

<!-- END GENERATED SKILLS -->

`/status` and `/diagnose` are read-only. Every other skill mutates the
workspace and asks for approval before it does.

For the knowledge lifecycle, `/wiki-ingest` is the narrowest rerun: it ingests
what already waits in `raw/untracked/` and runs the complete TAXO operation —
section fiches, tags and tag/family pivots — under one approval. It is not split
into separate analysis or write tasks.

You can also describe the goal in ordinary language — "run the deliver skill
with the quarterly template" — instead of typing the command. See
`04-interaction-modes.md`.

## What's a panel, not a command

Everything below is a **UI panel**, not something you type:

- **Workspace home** — the home page (`/`) summarizes the wiki, deliverables,
  templates and pending sources. Its counts open the matching section. The
  priority card links to a pending run approval, a curation proposal, sources
  waiting for ingestion, or wiki exploration. Runtime approval status is checked
  when the page opens; if it cannot be checked, the page points you to Activity.

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
  the panel fills in as each file lands. While the agent works, the file also
  shows in Pending as a **spinner row that is not clickable** — it becomes an
  ordinary source once the conversion lands, and if the conversion fails the
  row simply disappears. While a run is in progress, a Markdown
  drop is refused — the tree is read-only during a run — whereas a PDF or text
  drop goes through and waits for the next ingestion. Its lightning button
  starts the ingestion of everything pending.
- **Wiki browser sidebar** — three views behind the small icon rail on the
  left, in the order of the work: **Pending** (inbox, the default view),
  **Wiki pages** (brain) and **Files** (Context / Templates / Deliverables
  tabs). Each view owns the full height. In the Files view each collection's root reads in capitals and its
  contents with a leading capital. Deliverables carry a small icon per
  production type — a hammer for built documents, an export arrow, a sparkle
  for polished ones. The **wiki row** carries the history glyph: it reruns TAXO
  for the **archived** sources, rebuilding section fiches and tag-family pivots,
  then verifies the wiki's links and OKF front-matter — the same operation as `/wiki-rebuild`, run
  through Donna with the normal approval. It does **not** build, export or
  publish deliverables.
  The Pending tree shows only folders that hold at least one document
  directly — empty ancestor chains are collapsed away. Wiki pages read by
  their title (first `#` heading) rather than their filename, and downloaded
  files   lose their leading transport hash (`8d5e3fe3-report.md` reads
  "report"); the real path stays on the tooltip. On the home page, *Main
  sections* is always visible and each section (concepts, sources,
  deliverables…) starts collapsed. A pending file a sync delivered and you
  then modified is shown in **orange** — keep it or delete it, your call; the
  sync never overwrites it.
- **Drag into the chat** — drag a `.md` row from the wiki tree or from Pending
  onto the conversation or the composer: it joins DONNA's context, exactly like
  the *+ Context* button (validated paths only, five at most; the selection is
  saved with the conversation). *+ Context* opens the split view so the
  document and the chat sit side by side; the **×** on the document column
  closes it and hands the full width to the chat; the split button reopens the
  pair.
- **Run-status strip** — while a run is active, a floating bar near the top of
  the window shows the document or step it is on, its percentage, the live
  counters and how long ago the agent last showed a sign of life. Drag it
  anywhere; it stays inside the window and reappears where you left it, even
  after a reload. It disappears once the run is over — the Activity panel keeps
  the outcome.
- **Activity panel** — live tracking of runs, with *List* and *Graph* views.
  Each of its three tabs (Plan, Files, Logs) has its own `Clear`; `Clear all`
  clears all three. `Reset plan` (Plan tab only) stops active work and purges
  the run — ask for confirmation first.
- **Execution view** — the same Run/Task graph as the Activity panel's *Graph*
  view, opened full-page. A curation run's subagents (Scout, Analyst, Critique,
  Redactor, Archivist) appear as child nodes of the run.
- **Redo** — on a past message, truncates the conversation back to that point.
- **Agent proposals** — the curation review queue: a link with an amber badge
  in the sidebar opens the pending diffs, each read as a plain-language summary
  with the changed pages named and a coloured diff. *Merge into the wiki*
  applies a proposal (pages are recorded as verified and stable) and discards
  the branch; *Reject* discards it and leaves the wiki untouched. A **Start a
  curation** button on the page launches a new curation through DONNA (with a
  confirmation), so you never have to type the objective.
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
