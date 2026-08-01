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
  2. In the Shell, `/services` to see the state.
  3. Use `/start all` for agents and workspace services, `/start agents` for the
     agents only, or `/start services` for workspace services only.
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

## A service is "unavailable or disabled"

- **Symptom**: DONNA answers that a service — the connectors service, for
  example — is unavailable or disabled, and its container is nowhere to be seen,
  not even stopped, in the service list.
- **Cause**: some optional services sit behind a Docker Compose *profile*. While
  the profile is off, the container does not exist at all: it is invisible to
  every Compose command, `ps` included. This looks exactly like a service that
  crashed, but nothing ever started.
- **Fix**: the switch is a flag in the **manager's `.env`** file, next to
  `docker-compose.yml` — not in the workspace `.wikirc.yaml`, and not in any
  per-connector file. For the connectors service the flag is
  `CONNECTORS_ENABLED`:

  1. set `CONNECTORS_ENABLED=true` in the manager `.env`
  2. run `/start agents` (or `wiki-workspace agents up`) to start the container
  3. run `/connector list` to check it answers

  Once the flag is on, a missing container is reported as a real failure rather
  than as an opt-out. `/connector list` states which of the two cases you are in.

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
- **Cause**: an orchestrated task may have been retried after an interruption.
- **Fix**: retries of the same mutating task reuse its idempotency key. Check the
  current run before intentionally starting a distinct new operation.

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
