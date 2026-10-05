# Shell commands (terminal cockpit)

These commands only exist in the **Shell**, the terminal cockpit launched with
`wiki-manager`. They start, stop and administer the Docker infrastructure
itself — workspaces, services, agents, raw connector state — which a browser
page has no way to reach, since Serve is a web UI running *inside* an
already-running workspace container.

If you are in the **Serve** web interface, none of the commands on this page
can be typed into the chat composer. What you can do there — running a
production skill, checking status, approving a step, managing connectors — is
in `08-commands-serve.md`. Parameters in angle brackets `<…>` are to be
replaced; those in square brackets `[…]` are optional.

## General

- `/help` — show the Shell's own command cheatsheet.
- `/version` — show the version.
- `/openui` — open the Serve interface in the browser.
- `/clear` — clear the screen; `/clear --all` also resets run, plan, queue and
  logs.
- `/remember <fact>` — save a durable fact in the active workspace's shared
  memory. `/memory` lists facts; `/memory history <key>` shows revisions;
  `/memory restore <key> <history-id>` restores one; `/forget <key>` removes it.
  These are requests to Donna, in agent mode whatever the current mode: she
  performs them with her memory tools and answers in your language. They need
  the runtime. Donna may also extract durable facts from user messages; credential-shaped
  messages are skipped, and saved facts are reversible. Automatic extraction
  can be disabled by the workspace operator. Facts remain workspace-scoped;
  they remain until forgotten or the workspace is deleted.
  conversation threads stay separate unless you ask Donna to consult another.
- `/maintenance status | enable | disable | pause | resume | stop` — automatic
  maintenance (see *Automatic maintenance*); `enable`/`disable` act on the
  current workspace. `/maintenance approve <id> <version>`
  and `/maintenance refuse <id> <version>` answer a pending decision; the right
  pane offers the same Approve / Refuse buttons.
- `/exit` — quit the cockpit.

## Workspaces and configuration

- `/workspace list` — list workspaces.
- `/new <name> [path]` — create a workspace.
- `/use <workspace>` — select the active workspace (all following actions apply
  to it).
- `/workspace delete <name>` — delete a workspace.
- `/config list` — list configuration profiles.
- `/config use <name>` — activate a profile.
- `/config edit <name>` — edit a profile.

## Services and infrastructure

- `/services` — list services and their state.
- `/start all` — start the agent stack first, then workspace services.
- `/start agents` (or `/start agent`) — start only the agent stack.
- `/start services` — start only workspace services.
- `/stop [all|service|agents]` — stop the requested services.
- `/logs <service>` — show a service's logs.
- `/mcp status` — state of the MCP connectors. In Serve, the Connectors panel
  shows this instead.
- `/mcp endpoints` — declared MCP endpoints.
- `/mcp tools [mcp]` — tools exposed by the connectors.
- `/connector list` — connector authorization status.
- `/connector auth <name>` — authorize a connector.

## Documents and wiki (raw CLI)

- `/upload <path>` — upload a document into the workspace. In Serve, use the
  upload button in the chat composer instead.
- `/uploads` — list uploaded documents.
- `/upload convert pending` — convert pending documents to Markdown.
- `/uploads clean` — clean up uploaded documents.
- `/wiki` — (re)generate the wiki index directly, bypassing the runtime.
- `/wiki run <args>` — run the raw wiki CLI (advanced). Useful raw examples:
  `wiki ingest --from-ingested [files…]` (rebuild TAXO fiches and tag-family
  pivots from the archived sources), `wiki doctor --apply` (write the missing
  OKF keys and migrate older pages to the v0.2 format).

These are direct, synchronous CLI calls. The production skills go through the
same orchestrated, approved path in both interfaces and are almost always the
right choice instead — `08-commands-serve.md` lists them, and that list is
generated from the shipped skills, so it is the one to trust.

## Skill administration

- `/skills show <name>` — show a skill's declared parameters and body.
- `/skills edit <name>` — edit a skill's source file directly.

Serve does not have these two as typed commands, but its Connectors panel has
an equivalent visual skill editor (create, edit, save). Listing and *running*
a skill (`/skills`, `/skills run <name>`) works identically in both interfaces
— see `08-commands-serve.md`.

## Keyboard shortcuts (Shell)

- `Ctrl+Y` — copy the last reply.
- `PgUp` / `PgDn` — scroll the thread.
- `Ctrl+C` `Ctrl+C` — quit.

## Notes

- A product or status question remains answerable in chat. A mutating action
  (ingest, build, export, configure) requires agent mode and an available
  runtime.
- When blocked, `/status` then `/services` are the two diagnostic reflexes (see
  `06-troubleshooting.md`).
