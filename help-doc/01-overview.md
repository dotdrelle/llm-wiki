# Overview

## At a glance

DONNA turns a mass of scattered documents into structured, searchable
knowledge — a **wiki** — then produces finished **deliverables** from templates.
It runs locally: your content stays on your infrastructure, and the language
model (LLM) that powers its reasoning is a service you configure yourself.

Three activities sum up its work:

- **Gather** your sources: Confluence pages, files you upload, documents
  converted to Markdown.
- **Build the wiki**: extract durable knowledge pages (concepts, actors, rules,
  architectures…), link them together, and map them in an index.
- **Regenerate deliverables**: produce finished documents from templates, kept
  consistent with the wiki.

## Architecture in brief

You only ever talk to **DONNA**. Behind the scenes, it **orchestrates**
specialized agents, each an expert in one area:

- a **production** agent for wiki processing (diagnose, ingest, build, export…);
- an **external sources** agent for exporting from Confluence;
- a **documents** agent to convert files to Markdown before ingestion;
- an optional **mailer** agent for delivery by email.

Agents never talk to each other directly: everything flows back through DONNA,
which decides, sequences and controls. You do not need to know or name them — you
state a goal and DONNA picks who carries it out (see the notion of *capability*
in `04-interaction-modes.md` and in the glossary).

## The workspace

You work inside a **workspace**: an isolated space with its own sources, its own
wiki and its own deliverables. You can have several — one per project, client or
domain — and they are **sealed** from each other: one workspace's content is
never visible from another. The command `/use <workspace>` selects the one you
act on.

## Operating principles

- **Capability-driven.** You describe *what* to do; DONNA determines *who* does
  it. No need to know the internal organization of agents.
- **Confirmation before any change.** Import, ingest, build, export, send: each
  of these asks for your approval. DONNA does not act behind your back.
- **No duplicates.** Actions that modify are *idempotent*: re-running an
  operation does not recreate what already exists.
- **Chat stays available during processing.** You can keep asking questions while
  a job runs.
- **Recovery after interruption.** A job interrupted (restart, outage) is
  re-attached automatically at the next start.

## Local-first and privacy

Everything happens on your infrastructure. The LLM is an OpenAI-compatible
endpoint you choose (hosted by you or by a provider). Your sources, wiki and
deliverables do not leave your environment because of the application.

To understand how this content flows day to day, see `03-content-lifecycle.md`.
