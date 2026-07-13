# Interfaces and entry points

DONNA is used through three complementary interfaces. They share the same engine
and the same content; they differ by usage and entry point.

## The Shell (cockpit)

A terminal cockpit, launched with `wiki-manager`. It is the most complete
interface: it drives everything through **commands** (see `07-commands.md`) —
manage workspaces, start/stop services, talk to DONNA in chat or agent mode,
follow runs.

- **Entry point**: run `wiki-manager` in a terminal.
- **For whom**: setup, administration, advanced use, automation.
- **What you do there**: `/use` a workspace, `/start` services, `/chat` and
  `/agent`, `/status`, `/run`, `/approve`, `/logs`…
- **Switch to the web**: `/openui` opens the Serve interface in the browser.

## Serve (the workspace web UI)

The web interface of a workspace, served by `wiki serve`. This is the everyday
surface: a chat with DONNA, an **Activity** panel to follow processing, and a
wiki browser. The LLM is usually pre-configured there.

- **Entry point**: open the workspace URL in a browser (or `/openui` from the
  Shell). Page `/`.
- **For whom**: day-to-day use, without a terminal.
- **What you find there**:
  - **Chat / Agent** — the dialogue with DONNA (page `/`), with shortcuts on the
    empty screen (help, fill the workspace profile, contextual tips).
  - **Activity** — live tracking of imports, ingestions, exports and jobs, with
    two views: *List* and *Graph*.
  - **Wiki browser** — browse the pages produced.

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
