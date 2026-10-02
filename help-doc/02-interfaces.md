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
  - **Workspace home** — a short overview with clickable counts and the next
    action to take: a run approval, a curation proposal, pending sources, or
    wiki exploration. If runtime status cannot be checked, the page says so.
  - **Activity** — live tracking of imports, ingestions, exports and jobs, with
    two views: *List* and *Graph*.
  - **Wiki browser** — browse the pages produced. Its sidebar holds three views
    behind an icon rail — Pending (the default, the inbox), Wiki pages and
    Files (context / templates / deliverables) — and a page can be dragged from
    the tree straight into the chat to add it to DONNA's context (the selection
    is saved with the conversation). In split mode, the × on the document
    column closes it and hands the full width to the chat.
  - **Agent proposals** — the curation review queue: the diffs `agent.curate`
    produced on its branches, each read as a plain-language summary with the
    changed pages named, the justification and a coloured diff, and a
    **Merge** / **Reject** decision (an amber badge in the sidebar shows how
    many are waiting). A **Start a curation** button on the page starts a new
    curation run through DONNA (it asks for confirmation first).
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

A **visual** view of the wiki's taxonomy: the concept families, their concepts
and the source sheets (fiches) that back them. Useful to see how the knowledge
is organized, which families overlap, and which sources a concept rests on.

- **Entry point**: page `/graph` of the Serve interface. The *Graph* view of the
  Activity panel also offers a representation of running processing.
- **For whom**: explore and understand the wiki's organization at a glance.

Four views, from the widest to the most detailed:

- **Families** — each family radiates its concepts; two families are linked
  when they share sources, and the number on the link counts them.
- **Concepts** — two concepts are linked when one source cites both; the
  stroke thickens with the number of shared sources.
- **Concept focus** — one concept in the centre, its sources on the first ring,
  then the other concepts those sources cite. Click an outer concept to move
  there; pick another one from the list.
- **Concepts + sources** — every concept and every source sheet, each source
  linked to the concepts it tags.

### Provenance of a deliverable

A separate page answers a different question: *where does this deliverable's
evidence come from?* Open it with the **Provenance** link at the top of any
deliverable page (an exported or polished copy opens its source deliverable).
It reads left to right in five columns: the template and build context that
produced the deliverable, its sections that cite something, the concept pivots
and source sheets each citation went through, and the exact passages of the
archived originals it rests on. Hover or click a section, a page or a passage
to light every chain through it; the card below lists those chains and, for a
passage, shows its exact text.

By default the page shows the **frozen evidence** of the build — exactly what
the deliverable was built on, and what an export uses. A passage whose archive
changed since is badged *changed since build*, and the card shows both texts.
*Current files* resolves the chains again from today's files; a chain the build
used that no longer resolves is drawn as a dashed red line. The banner at the
top always says which evidence you are looking at and lists every warning
(missing manifest, broken anchor, passage no longer reached). When the
deliverable was built several times, a list picks the build to show.

The left column hides or shows a family, or the sources. The *Selection* panel
on the right describes what you clicked — a family, a concept or a source —
and lists its neighbours. Clicking a **source** also opens its summary card:
a short summary, *Open page* to read it in place, and *Add to Donna* to put it
in the chat's context.

The search box uses the same search as Donna: semantic (vector) when the
workspace's vector index is built, otherwise lexical. A spinner turns in the
field while it searches; a chip beside it then says which one answered —
*semantic + lexical*, or in amber *lexical only* when the vector index was not
used, and *weak matches* when nothing scored as truly relevant (the closest
pages are shown anyway). It highlights the matching concepts and sources (on the
Families and Concepts views, the concepts the matching sources tag) and lists
them, best match first, in the Selection panel.

## Which interface to choose

| Need | Interface |
|------|-----------|
| Install, administer, drive everything by command | **Shell** |
| Everyday use: chat, follow, read the wiki | **Serve** |
| Visually explore the structure of the knowledge | **Graph** (`/graph`) |

All three act on the **active workspace** and the same content: what you do in
one is visible in the others. The choice of chat/agent modes
(`04-interaction-modes.md`) applies to the Shell as well as to Serve.
