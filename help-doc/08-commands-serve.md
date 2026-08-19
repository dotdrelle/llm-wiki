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
directly (`/pipeline`) or `/skills run <name> [arguments]`:

- `/status`, `/diagnose` — read-only checks.
- `/wiki-sync [source]` — export a source, then ingest it.
- `/wiki-ingest [files]` — ingest what already sits in `raw/untracked/`.
- `/wiki-build [template]` — build deliverables.
- `/deliver [deliverable] [polish]` — export, or polish, existing deliverables.
- `/pipeline` — the one-shot shortcut through the whole chain.

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
