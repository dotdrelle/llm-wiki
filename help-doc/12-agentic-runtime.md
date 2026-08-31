# The agentic runtime: thinking beyond the plan

DONNA can also call on an **agentic runtime** — an external analysis engine
(Deep Agents or another) that works like an autonomous analyst: it explores,
reasons, compares, and comes to its own conclusions. It is the option for
questions that are **open** — the kind you cannot write as a step-by-step
recipe.

## The idea in one image

The agentic runtime has **eyes, ideas and a mouth** — but **no hands on your
workspace**.

- **Eyes** — it reads: wiki pages, source documents, and, when available, web
  search tools.
- **Ideas** — it reasons freely, forms its own judgement, may spawn sub-agents.
- **Mouth** — it can say something out loud — for example send a report by
  email — but only after your approval.

The **hands** are the deterministic plan (ingestion, build, export, taxonomy),
and there is exactly **one pair of hands per workspace**. The runtime never
holds them. When it wants something done — "this file did not pass, re-sync
it" — it does not launch anything: it **proposes**, DONNA integrates the
proposal into the plan, and the job then runs like any other job, with
approval.

## Chat, agent, agentic — which one

| You want to… | Use | Example |
|--------------|-----|---------|
| Know, check, understand | **chat** (read-only tools) | "Where does my wiki stand?" |
| Run a known operation | **agent** (deterministic plan) | "Ingest my new sources." |
| Explore, judge, get an open analysis | **agentic** | "Audit the concept coverage." |

The three cooperate. Chat can observe at any time, even while something runs.
Agent executes what has been decided. The agentic runtime thinks about what
*should* be decided — then hands its conclusions back to agent mode, which
executes them under the usual rules.

## How you use it

Describe the analysis in your own words, in agent mode:

- "Audit the concept coverage of the workspace."
- "Check the wiki for contradictions between pages and their sources."
- "Synthesize the sources about sovereignty, completing with the web if available."

You never name the engine or a capability. DONNA routes the request to the
declared agentic capability (for example `agent.review`) from its aliases and
description, and shows you the run in the Activity panel.

## Approval on the analysis

Before doing anything that changes the outside world, the runtime presents
**what it intends to do**: the tools it plans to use and the mutations it
foresees ("read the sources, send a report to the Notifications profile,
propose a re-sync of file X"). You see the ⏸ banner, review the announced
scope, and `/approve` (or click Approve). The runtime then works **within
that scope**; if it wants to step outside, it pauses and asks again.

Read-only analyses need no approval. Proposals that lead to workspace changes
(write a finding, re-run a step) always enter the plan as tasks waiting for
your approval, like any other mutation.

## What the runtime cannot do

- It cannot modify the workspace directly — no ingestion, build or page edit
  of its own.
- It cannot bypass approval: sending a mail or writing a finding waits for
  your `/approve`.
- It cannot take over a known operation: "sync" and "ingest" route to the
  production pipeline, not to the runtime.
- If the runtime is unavailable, its capabilities simply disappear from
  `/status` — everything else keeps working.

## DONNA's role

DONNA is your single point of contact and the **governor**:

- she interprets what you ask and routes it — chat, agent, or agentic;
- she owns the conversation: every clarification, progress line and final
  summary comes from her;
- she integrates what the runtime proposes into the plan and applies the
  approval rules;
- the runtime reasons; DONNA decides how, and whether, the workspace moves.

In short: **the runtime is the analyst you hire; DONNA is the manager with the
keys.**
