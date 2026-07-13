# Command reference

Commands are used in the Shell (the `wiki-manager` cockpit) and start with a
slash. They are grouped below by purpose. Parameters in angle brackets `<…>` are
to be replaced; those in square brackets `[…]` are optional.

## General

- `/help` — show help.
- `/version` — show the version.
- `/openui` — open the web interface (Serve) in the browser.
- `/clear` — clear the screen; `/clear --all` also resets run, plan, queue and
  logs.
- `/exit` — quit the cockpit.

## Workspaces and configuration

- `/workspace list` — list workspaces.
- `/new <name> [path]` — create a workspace.
- `/use <workspace>` — select the active workspace (all following actions apply
  to it).
- `/workspace delete <name>` — delete a workspace.
- `/status` — sum up the workspace: LLM, connectors, sources, content,
  deliverables. **The first command to run when in doubt.**
- `/config list` — list configuration profiles.
- `/config use <name>` — activate a profile.
- `/config edit <name>` — edit a profile.

## Dialogue modes

- `/chat` — switch to chat mode (read-only: questions, state).
- `/agent` — switch to agent mode (orchestration: actions and processing).

## Services and infrastructure

- `/services` — list services and their state.
- `/start [all|service|agents]` — start one or all services (or the global
  agents).
- `/stop [all|service|agents]` — stop one or all services.
- `/logs <service>` — show a service's logs.
- `/mcp status` — state of the MCP connectors.
- `/mcp endpoints` — declared MCP endpoints.
- `/mcp tools [mcp]` — tools exposed by the connectors.
- `/mcp call …` — call an MCP tool directly (advanced).

## Documents and wiki

- `/upload <path>` — upload a document into the workspace.
- `/uploads` — list uploaded documents.
- `/upload convert pending` — convert pending documents to Markdown.
- `/uploads clean` — clean up uploaded documents.
- `/wiki` — (re)generate the wiki index.
- `/wiki run <args>` — run the raw wiki CLI (advanced).

## Skills

- `/skills` — list available skills.
- `/skills show <name>` — show a skill.
- `/skills run <name>` — run a skill's guide.
- `/skills edit <name>` — edit a skill.

## Execution and orchestration (agent mode)

- `/run status` — state of the runtime and the current run.
- `/run capability <id>` — launch a deterministic run by capability.
- `/run cancel` (or `/cancel`) — cancel the active run.
- `/run kill` — force-stop the runtime run(s).
- `/approve` — grant a pending approval (sensitive step of a job).
- `/queue` — show the MCP job queue.
- `/queue clear` — clear finished jobs.
- `/queue cancel <id>` — cancel a queued or running job.

## Keyboard shortcuts (Shell)

- `Ctrl+Y` — copy the last reply.
- `PgUp` / `PgDn` — scroll the thread.
- `Ctrl+C` `Ctrl+C` — quit.

## Notes

- An **action** command (ingest, build, export, configure) assumes agent mode and
  an available runtime. In chat mode, DONNA will point you to `/agent`.
- When blocked, `/status` then `/services` are the two diagnostic reflexes (see
  `06-troubleshooting.md`).
