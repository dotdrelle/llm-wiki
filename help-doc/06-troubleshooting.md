# Troubleshooting

Most blockers have a simple cause. Reflex #1: run `/status` (workspace state)
then, if needed, `/services` (container state). Each case below gives the
**symptom**, the **cause** and the **fix**.

## Nothing responds / the UI won't open — Docker is not running

- **Symptom**: the Serve interface won't open, commands fail, or a message
  mentions the Docker daemon ("Cannot connect to the Docker daemon", "Is the
  docker daemon running").
- **Cause**: Docker is not started, or the workspace services are not running.
  DONNA and its agents run in containers.
- **Fix**:
  1. Start **Docker Desktop** (or the Docker daemon) and wait until it is ready.
  2. In the Shell, `/services` to see the state, then `/start all` to start the
     workspace services.
  3. Need the connectors (Confluence, documents)? `/start agents`.
  4. Re-check with `/status`.

## Agent mode is disabled

- **Symptom**: you cannot launch an action; a message says the runtime is
  unavailable (for example a port conflict), the agent is cut off.
- **Cause**: the execution component (runtime) is not reachable.
- **Fix**: **chat stays usable** for questions in the meantime. Check services
  (`/services`, `/start`), consult `/run status` and the runtime `/logs`. Once
  the runtime is back, `/agent` becomes available again.

## DONNA does not answer, or answers poorly — LLM

- **Symptom**: empty, inconsistent answers, or a refusal to analyze.
- **Cause**: LLM missing, misconfigured, or too weak.
- **Fix**: check the model shown at the top of the interface; fill in Base URL,
  Model and (if required) the API key. Pick a capable model: ingestion fails with
  a model that is too light.

## A connector doesn't work

- **Symptom**: a Confluence source or document conversion fails; a tool "is not
  available".
- **Cause**: connector present but **not configured**, or agents not started.
- **Fix**: `/mcp status` for connector state; `/start agents` if they are not
  running; in chat, ask for the connector's status. If it needs configuration,
  DONNA will ask only for the required fields, then set it up after confirmation.

## Ingestion rejects pages

- **Symptom**: at the dry-run, some pages are marked rejected.
- **Cause**: content judged irrelevant or redundant.
- **Fix**: this is normal and expected. Review the plan, discuss the rejects with
  DONNA, adjust if needed, then apply. Nothing is written until you confirm.

## A job seems stuck

- **Symptom**: a job stays in progress without advancing.
- **Cause**: waiting for an approval, or a long-running task.
- **Fix**: open the **Activity** panel; `/run status` and `/queue` for the state;
  `/approve` if an approval is pending; `/cancel` (or `/run cancel`) to stop,
  `/queue cancel <id>` for a specific job.

## Did I create duplicates?

- **Symptom**: fear of duplicating by re-running an operation.
- **Cause**: none — actions that modify are **idempotent**.
- **Fix**: re-running does not recreate what already exists; only what is needed
  is updated.

## Getting back to a clean state

- `/status`: full diagnosis.
- `/clear --all`: resets the screen, run, plan, queue and session logs (does not
  delete your wiki).
- `doctor` (in agent mode): diagnosis of the workspace itself.

## I don't know what to do

- Understand the app: `01-overview.md`, `03-content-lifecycle.md`.
- Choose the right mode: `04-interaction-modes.md`.
- Start from scratch: `05-getting-started.md`.
- Every command: `07-commands.md`.

Still stuck? Describe to DONNA, in chat, what you are trying to do and what you
see on screen: it will point you to the next step.
