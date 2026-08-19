# Configuration and performance

This chapter explains the agent configuration shown by `/status`. It describes
the product settings, not the content or secrets of a particular workspace.

## Agents and capabilities

DONNA discovers connected agents from their contracts. Each agent announces
the capabilities it can provide and its execution limits. Donna routes a task
by capability rather than by a hard-coded agent name.

An agent may publish:

- a **recommended concurrency**, suitable for normal operation;
- a **maximum concurrency**, which the agent will not exceed;
- operation-specific limits and locks.

The values shown by `/status` come from the currently discovered agent when it
is connected. Environment defaults are used only when live discovery has not
provided the limits.

## Parallelism and throughput

**Parallelism & throughput** describes production work such as ingestion,
building, polishing and exporting.

- **effective** — the concurrency Donna can actually use after applying all
  known limits;
- **recommended** — the normal operating level announced by the production
  agent;
- **maximum** — the hard limit announced by that agent;
- **scheduler workers** — the manager's worker capacity for dispatching ready
  tasks.

The effective value is the smallest applicable limit: agent recommendation,
agent maximum, an optional manager cap, and any narrower limit in the plan.
Increasing a maximum alone does not raise the effective value when the
recommendation or a task limit is lower.

These numbers are capacities, not a promise that every phase runs in parallel.
Locks protect shared resources. In particular, operations that write the same
workspace or deliverable may be serialized even when the displayed effective
concurrency is higher.

## Collection concurrency

**Collection concurrency** applies to connector work, for example reading
several external items.

- **effective** — simultaneous collection tasks currently allowed;
- **recommended** — the connector agent's normal operating level;
- **maximum** — the connector agent's hard limit.

External service quotas, network latency and provider rate limits can reduce
observed throughput without changing these configured limits.

## Configuration sources

Agent limits are configured through the manager environment and passed to the
relevant containers:

- `PRODUCTION_RECOMMENDED_CONCURRENCY`;
- `PRODUCTION_MAX_CONCURRENCY`;
- `CONNECTORS_RECOMMENDED_CONCURRENCY`;
- `CONNECTORS_MAX_CONCURRENCY`.

`WIKI_MANAGER_CAPABILITY_CONCURRENCY` is an optional global cap. It can only
lower the concurrency selected from the agent contract; leaving it unset lets
the agent and plan limits decide. `WIKI_MANAGER_SCHEDULER_CONCURRENCY` controls
the manager worker capacity.

`/status` (Shell or Serve) shows the resolved runtime values. Distinguishing a
performance setting from a disconnected agent or connector needs the
infrastructure-level view — the Shell's `/services` and `/mcp status`
(`07-commands-shell.md`), or the Connectors panel in Serve.

## Choosing values

Start from the shipped defaults and change them only when measurements justify
it. Raise concurrency when the LLM endpoint, connector APIs and host resources
can serve more requests simultaneously. Lower it when you observe rate-limit
errors, memory pressure, timeouts or an overloaded model endpoint.

These are container environment values, changed where the manager's
`docker-compose.yml`/`.env` live — that part is Shell/administration territory
even if you read the result in Serve. After changing them, restart the
affected services and check `/status` again. The live agent contract is the
authoritative result.
