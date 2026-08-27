# Documentation — DONNA

## Introduction

DONNA is an assistant that builds and maintains a **knowledge wiki** from your
documents, then regenerates **deliverables** from templates. It runs locally, in
isolated spaces called *workspaces*, and never performs an action that changes
your data without your confirmation.

This documentation covers the application, its concepts, its two interaction
modes, configuration and performance, how to get started, the command
reference, and a glossary.

## Three things to remember

- **Two modes.** You *ask questions* in chat mode (read-only); you *make DONNA
  act* in agent mode (processing). See `04-interaction-modes.md`.
- **One cycle.** Your sources become a wiki through *ingestion*, and the wiki
  then feeds *deliverables* through *build*. See `03-content-lifecycle.md`.
- **Under control.** Every action that changes something asks for confirmation,
  and you follow everything in the *Activity* panel.

## Organization

Read it in order for a full tour, or chapter by chapter as needed.

1. **Overview** — `01-overview.md` — what the application is, its architecture
   and principles.
2. **Interfaces and entry points** — `02-interfaces.md` — shell, serve, graph,
   and where to start.
3. **Content lifecycle** — `03-content-lifecycle.md` — from source to
   deliverable.
4. **Interaction modes: chat and agent** — `04-interaction-modes.md` — when to
   consult, when to act.
5. **Getting started** — `05-getting-started.md` — configure, ingest, produce.
6. **Troubleshooting** — `06-troubleshooting.md` — diagnose and unblock.
7. **Shell commands** — `07-commands-shell.md` — the terminal cockpit's
   commands, grouped by purpose.
8. **Actions in Serve** — `08-commands-serve.md` — what you can type or click
   in the web interface.
9. **Glossary** — `09-glossary.md` — the reference vocabulary.
10. **Configuration and performance** — `10-configuration-performance.md` —
    agents, parallelism, collection concurrency, and the `/status` indicators.
11. **Staying up to date** — `11-staying-up-to-date.md` — how drift is detected
    and how to keep the documentation current, including headless automation.

## Conventions

Technical terms (workspace, ingestion, deliverable, capability…) are defined in
the glossary. Commands start with a slash, e.g. `/status`. This documentation
assumes you have an active workspace; `/use <workspace>` switches between them.
