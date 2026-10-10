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
- **maximum** — the hard limit announced by that agent.

The effective value is the smallest applicable limit: agent recommendation,
agent maximum, an optional manager cap, and any narrower limit in the plan.
Increasing a maximum alone does not raise the effective value when the
recommendation or a task limit is lower.

These numbers are capacities, not a promise that every phase runs in parallel.
Locks protect shared resources. In particular, operations that write the same
workspace or deliverable may be serialized even when the displayed effective
concurrency is higher.

### Reading the run summary

The Shell run summary shows **running plan tasks / simultaneous-task limit**.
`Concurrent tasks: 1 / 4` means one task is running and the scheduler allows
up to four. Older versions displayed this as `parallel 1/×4`; it was not a
multiplication. `0/1 tasks` beside it means zero of the plan's one
task have completed. A list of input files does not mean one task per file.

An ingestion is **one task** over the whole batch. It can therefore show
`Concurrent tasks: 1 / 4` even while several model calls run inside that task. Raising
the production task limit does not split ingestion into more tasks.

Inside ingestion, the engine extracts sections from several source files with
a shared model-call budget. By default that budget is the same production
recommendation (`PRODUCTION_RECOMMENDED_CONCURRENCY`), so raising it raises
both the task limit and the extraction capacity. A workspace can pin its own
value with `limits.maxInFlightRequests` in its `.wikirc.yaml` (default 3, at
most 16); an explicit value then wins over the production recommendation.
Writes remain serialized. The run graph and Plan step list each input file as
pending, running, done or failed; those file states do not count simultaneous
model calls.

`LLM calls per ingestion: limit 6` shows the extraction capacity actually in
force — the workspace value when set, otherwise the production recommendation —
not a live count of calls. If the runtime has no configuration to report, the
summary says `limit not reported`. The batch note explains that one ingestion
task processes its input files. The Shell also shows the agent recommendation,
agent maximum and manager cap; in Serve these appear in the task counter tooltip
and the run inspector.

## Collection concurrency

**Collection concurrency** applies to connector work, for example reading
several external items.

- **effective** — simultaneous collection tasks currently allowed;
- **recommended** — the connector agent's normal operating level;
- **maximum** — the connector agent's hard limit.

External service quotas, network latency and provider rate limits can reduce
observed throughput without changing these configured limits.

## Configuration sources

Agent limits are configured through the manager `.env` and passed to the
relevant containers. Connectors and production have separate defaults:

| Setting | Controls | Default |
| --- | --- | --- |
| `CONNECTORS_RECOMMENDED_CONCURRENCY` | Connector collection task concurrency | 2 |
| `CONNECTORS_MAX_CONCURRENCY` | Connector agent hard ceiling | 4 |
| `PRODUCTION_RECOMMENDED_CONCURRENCY` | Production task concurrency (build, export, polish) **and**, by default, in-job extraction calls (ingest, rebuild) | 4 |
| `PRODUCTION_MAX_CONCURRENCY` | Production agent hard ceiling | 8 |
| `WIKI_MANAGER_CAPABILITY_CONCURRENCY` | Additional manager ceiling | Unset |

The connector default of 2 does not limit production tasks to 2. Lines starting
with `#` in `.env` are comments: `# WIKI_MANAGER_CAPABILITY_CONCURRENCY=4`
does not activate a manager ceiling of 4.

`WIKI_MANAGER_CAPABILITY_CONCURRENCY` is an optional global cap, decided by
the manager rather than the agent. It can only lower the concurrency selected
from the agent contract, and it applies to every agent at once (production,
connectors, external runtimes) without recreating their containers. Leaving it
unset lets the agent and plan limits decide. Use it to protect a shared machine
or model endpoint globally; for production alone, lower
`PRODUCTION_RECOMMENDED_CONCURRENCY` instead.

The agentic gateway's own ceilings live in the same manager environment (all
optional, defaults in parentheses): `GATEWAY_RECURSION_LIMIT` (200) reasoning
steps, `GATEWAY_TOKEN_BUDGET` (2 000 000) estimated tokens, and — for curation
hands — `GATEWAY_WORKTREE_MAX_FILES` (40) / `GATEWAY_WORKTREE_MAX_DIFF_CHARS`
(300 000): beyond them a curation run fails loudly and discards its branch
instead of queueing a diff nobody can read, and `GATEWAY_WORKTREE_MAX_AGE_MS`
(7 days) prunes abandoned review branches at startup.

`/status` (Shell or Serve) shows the resolved runtime values. Distinguishing a
performance setting from a disconnected agent or connector needs the
infrastructure-level view — the Shell's `/services` and `/mcp status`
(`07-commands-shell.md`), or the Connectors panel in Serve.

## Choosing values

Start from the shipped defaults and change them only when measurements justify
it. Raise concurrency when the LLM endpoint, connector APIs and host resources
can serve more requests simultaneously. Lower it when you observe rate-limit
errors, memory pressure, timeouts or an overloaded model endpoint.

**To allow eight production tasks at once**, set active lines in the manager
`.env`:

```dotenv
PRODUCTION_RECOMMENDED_CONCURRENCY=8
PRODUCTION_MAX_CONCURRENCY=8
```

The optional manager cap (`WIKI_MANAGER_CAPABILITY_CONCURRENCY`) is not needed
here: leave it unset, or set it to 8 as well. Keeping it at 4 would cap these
tasks at 4. Raising only `MAX` leaves the agent's lower recommendation binding.
For collection work, change the `CONNECTORS_…` settings instead, keeping the
maximum at least as high as the desired recommendation. Ready tasks,
dependencies and locks still decide how many can actually run.

After changing container environment values, recreate the affected agent
containers; a container restart alone does not apply a changed Compose
environment. Restart the manager runtime if its environment changed, then
check `/status` and the next run's summary for the resolved values.

**To increase concurrent ingestion extraction calls**, raise
`PRODUCTION_RECOMMENDED_CONCURRENCY` with the rest: it is the same knob, and
the extraction budget follows it unless a workspace pins its own value. To
keep one workspace lower — a weaker model endpoint, for example — set an
explicit value in its `.wikirc.yaml`, preserving its other settings:

```yaml
limits:
  maxInFlightRequests: 3
```

An explicit workspace value wins over the production recommendation. The
change applies to the next ingestion or archive rebuild. The run can still show
`Concurrent tasks: 1 / 4`, because it remains one plan task. The LLM endpoint's capacity
and `limits.requestsPerMinute` also constrain throughput; the in-flight limit
does not change the request-start rate.
