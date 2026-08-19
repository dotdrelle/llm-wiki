# Getting started

This chapter goes from zero to a first deliverable. Each step can be left pending
and resumed later. At any time, `/status` sums things up and the **Activity**
panel shows what is running.

## Step 0 — Services are running

DONNA and its agents run in Docker containers. This step needs the **Shell**
(`wiki-manager`) — Serve is a web page running inside an already-started
workspace, so it cannot start or stop its own containers.

- make sure **Docker is started**;
- in the Shell, `/services` lists the state, `/start all` starts agents first
  and then workspace services, `/start agents` starts only the agent stack, and
  `/start services` starts only workspace services (see `07-commands-shell.md`).

If you only have the Serve interface and it does not respond, or if agent mode
is unavailable, someone with terminal access needs to check this first (see
`06-troubleshooting.md`).

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
- **Files**: upload your documents — the upload button in Serve's composer, or
  `/upload <path>` in the Shell — then `/upload convert pending` (Shell) or ask
  DONNA to convert pending documents to Markdown.

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

Start the required services, check the LLM, add a source, prepare and approve an
ingestion, then build and verify with `/status`. If something goes wrong, see
`06-troubleshooting.md`.
