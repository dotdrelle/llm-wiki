# Interaction modes: chat and agent

DONNA has two ways of working. The choice comes down to a single question: do you
want to **know** something, or to **have something done**?

## Chat mode — consult and understand

In chat, DONNA **reads and answers**. It has a small set of **read-only** tools
to consult the current state, and it never modifies anything.

This mode is right for: asking a question about your domain, getting an
explanation, checking a status ("is the connector configured?", "how many pages
in the wiki?"), understanding where you stand.

What chat **does not do**: import, ingest, build, export, send, configure. If you
ask for one of these actions, DONNA will invite you to switch to agent mode — it
will not pretend to run it and will never invent a result.

Good to know: chat stays **always available**, including while a job runs in
agent mode, and even if the orchestration infrastructure is momentarily
unavailable.

## Agent mode — make things happen

In agent, DONNA **orchestrates actions**. It breaks your goal into tasks, hands
them to the specialized agents (production, sources, documents…), and follows
their execution. You see everything unfold in the **Activity** panel.

This mode is right for: running an ingestion, rebuilding a deliverable, exporting
a space, configuring a connector.

A few guarantees specific to agent mode:

- **Confirmation** before any action that changes something.
- **Bounded approvals**: DONNA asks for your approval at sensitive steps, a
  limited number of times per run (`/approve` command).
- **Idempotence**: re-running does not duplicate work already done.
- **Recovery**: an interrupted job is re-attached at restart.

Agent mode relies on an execution component (the *runtime*). If it is
unavailable, the agent is temporarily cut off — but chat remains usable (see
`06-troubleshooting.md`).

## How to express yourself

You do not have to name an agent or a technical operation. You describe a
**goal** ("ingest my new sources", "rebuild the architecture note"); DONNA
identifies the required **capability** and routes the task to the agent able to
carry it out.

## In summary

| You want to… | Mode | Example |
|--------------|------|---------|
| Know, understand, check | **chat** | "Where does my wiki stand?" |
| Do, run, change | **agent** | "Ingest my new sources." |

Tip: if a chat answer calls for an action, DONNA offers to switch. Type `/agent`
to act, `/chat` to go back to questions. The full command reference is in
`07-commands.md`.
