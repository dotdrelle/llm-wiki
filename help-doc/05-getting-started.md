# Getting started

This chapter goes from zero to a first deliverable. Each step can be left pending
and resumed later. At any time, `/status` sums things up and the **Activity**
panel shows what is running.

## Step 0 — Services are running

DONNA and its agents run in Docker containers. First of all:

- make sure **Docker is started**;
- in the Shell, `/services` lists the state, `/start all` starts the workspace
  services, `/start agents` starts the global agents (connectors).

If the Serve interface does not respond, or if agent mode is unavailable, always
start by checking this (see `06-troubleshooting.md`).

## Step 1 — The language model (LLM)

DONNA needs an LLM to reason.

- In the Serve interface launched by `wiki serve`, the LLM is usually
  **pre-configured**: check that the model name shown at the top is correct.
- In standalone mode, fill in the settings:
  - **Base URL**: the OpenAI-compatible endpoint (for example a local instance or
    a provider's URL);
  - **Model**: the model name exposed by that endpoint;
  - **API key**: only if the provider requires it.

A capable model is required: a model that is too weak fails on ingestion.

## Step 2 — Add sources

Two ways:

- **Confluence**: configure the connector (base URL, username, personal access
  token; disable TLS verification for an internal certificate), then declare a
  space or pages as sources.
- **Files**: upload your documents with `/upload <path>`, then
  `/upload convert pending` to convert non-Markdown formats to Markdown.

## Step 3 — Ingest

In agent mode, request ingestion. Good practice in two stages:

1. **Dry-run**: DONNA prepares the plan of pages that would be created or
   updated, without writing anything.
2. **Apply**: after review (and discussion of any rejected pages), confirm to
   actually write.

The wiki then fills up: concepts, internal links, index and log updated.

## Step 4 — Build / export

Once the wiki is populated, request a **build**: DONNA regenerates the
deliverables from the templates, consistent with the wiki. As needed: **export**
to produce external outputs, **polish** to improve the form, **doctor** for a
diagnosis.

## Step 5 — Verify

- `/status`: the full state of the workspace.
- **Activity** panel: the detail of processing (List and Graph views).
- Page `/graph`: the map of the knowledge produced.

## First run, in short

`/start all` → check the LLM → add a source → dry-run ingestion then apply →
build → `/status`. If something goes wrong, `06-troubleshooting.md`.
