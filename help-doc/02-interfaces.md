# Interfaces and entry points

DONNA is used through three complementary interfaces. They share the same engine
and the same content; they differ by usage and entry point.

## The Shell (cockpit)

A terminal cockpit, launched with `wiki-manager`. It is the most complete
interface: it drives everything through **commands** (see
`07-commands-shell.md`) — manage workspaces, start/stop services, talk to
DONNA in chat or agent mode, follow runs.

- **Entry point**: run `wiki-manager` in a terminal.
- **For whom**: setup, administration, advanced use, automation.
- **What you do there**: `/use` a workspace, `/start` services, `/chat` and
  `/agent`, `/status`, `/run`, `/approve`, `/logs`…
- **Switch to the web**: `/openui` opens the Serve interface in the browser.

## Serve (the workspace web UI)

The web interface of a workspace, served by `wiki serve`. This is the everyday
surface: a chat with DONNA, an **Activity** panel to follow processing, and a
wiki browser. The LLM is usually pre-configured there. What you can type or
click here is `08-commands-serve.md` — it is not the Shell's command set:
Serve cannot start or stop containers, list workspaces or run the raw CLI.

- **Entry point**: open the workspace URL in a browser (or `/openui` from the
  Shell). Page `/`.
- **For whom**: day-to-day use, without a terminal.
- **What you find there**:
  - **Chat / Agent** — the dialogue with DONNA (page `/`), with shortcuts on the
    empty screen (help, fill the workspace profile).
  - **Activity** — live tracking of imports, ingestions, exports and jobs, with
    two views: *List* and *Graph*.
  - **Wiki browser** — browse the pages produced. Its sidebar holds three views
    behind an icon rail — Wiki pages, Files (context / templates /
    deliverables) and Pending (the default) — and a page can be dragged from
    the tree straight into the chat to add it to DONNA's context. In split
    mode, the × on the document column closes it and hands the full width to
    the chat.
  - **Connectors** — the MCP servers DONNA can call.

### Adding a connector from Serve

The Connectors panel lists every MCP server available to this workspace. You can
add one there: give it a name, its URL, an optional Bearer token, and connect.
Once connected, its tools are usable straight away — in chat, in agent mode, and
in the plans DONNA builds afterwards. Nothing to restart.

Each card says where it comes from:

- **internal** — the workspace's own servers. They cannot be edited or removed.
- **global config** — set up for the whole installation (Confluence export,
  document conversion, mail, and so on). Removing one takes it away from *every*
  chat, agent and future plan. Its container and its data are kept; only the
  wiring goes.
- **added here** — added from this panel.

A name may use letters, digits, dots, underscores and hyphens, and must start
with a letter or a digit.

Two cases are worth knowing. A card badged **`local only`** means the server
answered correctly and you can use it in this browser, but the shared
configuration has not recorded it yet — usually because a plan is running, since
connectors cannot be rewired under a run in progress. It syncs by itself the
next time you reconnect. And renaming a connector only takes effect once you
reconnect it, using the circular arrow on the card.

## The Graph (knowledge map)

A **visual** view of the wiki: pages (concepts) and their links, as a navigable
graph. Useful to explore the structure of the knowledge, spot clusters and move
from one concept to another.

- **Entry point**: page `/graph` of the Serve interface. The *Graph* view of the
  Activity panel also offers a representation of running processing.
- **For whom**: explore and understand the wiki's organization at a glance.

## Which interface to choose

| Need | Interface |
|------|-----------|
| Install, administer, drive everything by command | **Shell** |
| Everyday use: chat, follow, read the wiki | **Serve** |
| Visually explore the structure of the knowledge | **Graph** (`/graph`) |

All three act on the **active workspace** and the same content: what you do in
one is visible in the others. The choice of chat/agent modes
(`04-interaction-modes.md`) applies to the Shell as well as to Serve.
