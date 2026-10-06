# Automatic maintenance

Automatic maintenance keeps a workspace up to date **without you launching each
step by hand**: it synchronizes Confluence sources, ingests new documents,
checks the workspace, repairs the search index, rebuilds TAXO fiches when they
are inconsistent, prepares curations, rebuilds stale deliverables, updates
their existing exports and emails a summary.

It runs **beside Donna, not in her queue**: your chat, your runs and your skills
start immediately while maintenance works. It is **off by default**.

## What it does, and how

| Action | Same as | How it runs |
| --- | --- | --- |
| `sync` | `/wiki-sync` | the manager, on schedule, no model call |
| `doctor` | `/wiki run doctor` | the manager, once a day, no model call |
| `mail` | the skills' notification | the manager, no model call |
| `ingest` | `/wiki-ingest` | the maintenance agent |
| `index` | `/wiki run index` | the agent, only when the search index is behind |
| `rebuild` | `/wiki-rebuild` | the agent, only when TAXO fiches or tag pages are inconsistent |
| `curate` | `/curate` | the agent prepares a proposal; **you merge it** on `/agent-proposals` |
| `build` | `/wiki-build` | the agent, during the build window |
| `deliver` | `/deliver` | the agent, for exports and polished versions **that already exist** |

When nothing has changed, no model is called at all. The maintenance agent
(on the agentic runtime) is only started when there is real work to decide.

## Turning it on

The quickest way, for the workspace you are in:

- Shell: `/maintenance enable` (and `/maintenance disable`).
- Served chat: the **Maintenance** button (top right) → **Enable for this
  workspace**, after a confirmation.

It is off by default on purpose: once on, it acts on its own and uses your LLM
provider. Only you can turn it on — Donna can show, pause or stop it, never
enable it. Enabling says what it implies: which actions will ask you first,
and whether builds can run (they stay off until a build window is set).

Choose the approval mode in the served **Maintenance** panel or in the Shell
with `/maintenance mode auto` or `/maintenance mode human`. The setting is
saved for the current workspace in `maintenanceAccess.workspaces`.

- **Auto** runs each listed action without an approval request.
- **Human** asks before running each listed action.

The editable action list lives in `mcp.endpoints.json`, under
`maintenanceAccess.defaults.actions`; a workspace can override it. Remove an
action from the list to leave it disabled. The same maintenance agent and
workspace checks remain in place.

```json
"maintenanceAccess": {
  "defaults": {
    "enabled": false,
    "mode": "human",
    "actions": ["sync", "ingest", "doctor", "index", "rebuild", "curate", "build", "deliver", "mail"],
    "mail": { "to": [], "on": ["failure", "decision", "daily"] },
    "buildSchedule": { "mode": "window", "start": "02:00", "end": "05:00", "timezone": "Europe/Paris" },
    "limits": { "cyclesPerDay": 12, "buildsPerDay": 4, "actionsPerDay": 40,
                "actionsPerCycle": 10, "sourceQuietMinutes": 10 }
  },
  "workspaces": {
    "my-workspace": { "enabled": true, "actions": { "build": ["templates/offer.md"] } }
  }
}
```

A workspace inherits `defaults` and overrides only what it names. For `build`
and `deliver`, you can instead use an object mapping those action names to
lists of template or deliverable paths; paths outside the list stay disabled.
An invalid block turns nothing on and says why in `/maintenance status`.

## The decisions that stay yours

In **Human** mode, listed actions create approval requests in the Maintenance
panel (Serve) or right pane (Shell):

- **New sources**: after a sync or a copy into the pending area, it lists the
  new files and asks whether to ingest them.
- **Updating an existing export**: after a deliverable was rebuilt, it asks
  whether to update its export or polished version. It **never creates a
  first export** — publishing something new is your decision.

Three more rules always apply, whatever the settings:

- A pending file you **modified locally** after a Confluence sync is never
  ingested automatically — keep or delete it from Pending yourself.
- In **Human** mode, a listed rebuild requires approval; **Auto** runs listed
  rebuilds without an approval request. A rebuild — automatic or by hand — **keeps the sections you added**, word for
  word and where you put them; the sections the template produces are updated
  with the new content (an edit you made inside one of them is merged). A
  section the template stopped producing is removed. The file is backed up
  first in `.wiki/output-backups/` (last five versions).
  One exception: a deliverable last built before this version has no record of
  what the template produced, so its first rebuild cannot tell your sections
  apart; the request says so, and every rebuild after that keeps them.
- A curation is only **prepared**; the merge is yours.

**The latest request wins.** If new files arrive before you answer, the request
is replaced by an up-to-date one — requests never pile up. Approving a request
that has just been replaced is refused and the new one is shown instead, so you
never approve something you did not read. A refused file is not asked again
until it changes.

While a request waits, maintenance carries on with everything else.

## Seeing what it does

- **Toasts, bottom right**: each new event, with *Open*, *Stop* and *Dismiss*.
- **The Maintenance panel** (button at the top right of the served chat): the
  pending decisions with *Approve* / *Refuse*, *Pause* / *Resume* / *Stop*, and
  the maintenance thread — one entry per cycle with the agent's own summary,
  then routine work and decisions. **Ask Donna** on a cycle or a decision opens
  the chat with its facts in your message box: you add your question and send.
- **Logs**: every maintenance line also appears in the Logs tab of the served
  chat and in the Shell's Activity, prefixed `Maintenance:`.
- **`/status`** shows whether maintenance is active, paused or disabled, and how
  many decisions are waiting.

## Stopping it

- `/maintenance pause` — no new cycle until `/maintenance resume`.
- `/maintenance stop` — cancels the running cycle **and** the jobs it started,
  then pauses. Pending decisions stay.
- Ask Donna: "arrête la maintenance". She can show, pause or stop maintenance;
  she **cannot approve** a decision for you.
- `/kill` and deleting the workspace also stop it.

Stopping or restarting the runtime is not a Stop: a job already started keeps
running in its agent and is followed again when the runtime is back.

## When maintenance and your work meet

Maintenance never starts a new job while one of your runs has production work
waiting. A job it has already started is not interrupted: while an ingest or a
rebuild runs, the whole workspace is busy for every production job, yours
included. Your task then waits and the Logs say so (`waiting for maintenance —
…`). Reads, curations and mails never make you wait.

## Limits worth knowing

- **Builds are conservative**: any change of wiki content makes every allowed
  deliverable stale. The build window and `buildsPerDay` group those rebuilds.
- **No token ceiling** in this version: the limits count cycles and actions,
  not tokens.
- An engine update does not rebuild your deliverables: a deliverable whose wiki
  has not changed since its last build stays fresh.
- An export is also out of date when the way exports are written changed (a
  new export prompt version, or another session language); switching model or
  profile does not make exports stale.
- A deliverable is backed up before every rebuild; the last five versions of
  each are kept in `.wiki/output-backups/`.
- Without the agentic runtime, routine work (sync, doctor, mail) continues and
  the rest waits; the panel says so once.

## Saved history pages

The Maintenance panel shows recent history and keeps every pending decision
visible. Use **Older history** and **Newer history** to browse saved decision
pages. In the Shell, use `/maintenance status` for the first page and
`/maintenance status 2` (then 3, and so on) for older pages. Each page contains
up to 100 settled requests and 100 settled reservations; pending or approved
requests and reservations with unresolved effects remain visible on every page.
Pagination does not delete saved approvals, refusals or budget receipts.

The served Maintenance panel's **Clear** button deletes this workspace's
maintenance log events and its finished cycle history, after a confirmation;
pending decisions, saved approvals and refusals, and reservations with
unresolved effects stay visible. It never stops or pauses maintenance.

Maintenance logs are kept for **15 rolling days** by default. Set
`WIKI_MANAGER_LOG_RETENTION_DAYS` in the manager `.env` to a positive number of
days and restart the runtime to change this window. Older log events expire;
your saved decisions and budget receipts remain. History pages show up to 100
log events alongside decisions and receipts; use the history navigation to
read older retained pages. This setting covers the Maintenance journal;
technical files such as `runtime.log` and Docker/agent logs have separate lifecycles.
