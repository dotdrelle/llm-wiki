# Content lifecycle — specification

Status: specification, 2026-08-05. Decides what the engine **must** do when a
source appears, changes, goes quiet or disappears. Nothing here is implemented
without being written here first.

This document exists because the wiki knows how to grow and how to correct
itself, but not yet how to handle a disappearance. Adding code to that subject
by feel would produce three incompatible identity rules — one per ticket.

---

## 1. Two cycles, independent

`ingest` updates the wiki. `build` / `refresh` updates the deliverables and
**never touches the wiki**: it reads it.

```text
Sources → raw/untracked/ ──ingest──► wiki/ + raw/ingested/ ──build/refresh──► deliverables/
```

Three roles not to be confused:

| Location | Role |
| --- | --- |
| `raw/ingested/` | the **documentary evidence** — the raw document, archived as is |
| `wiki/sources/` | the **synthesis note for one source**, one per ingested document |
| `wiki/concepts/` | the **durable knowledge**, reusable, potentially multi-source |

---

## 2. What the engine does today

Verified in the code, not inferred.

### A source's identity is its path

`workspaceService.ts:541`:

```ts
const archiveRelativePath = `raw/ingested/${slugifyPath(relativeToUntracked)}`;
```

A source's identity is **the file's path under `raw/untracked/`**, slugified.
There is no upstream identifier, no version, no stored fingerprint.

Direct consequence, and the root of several symptoms: **renaming or moving a
page upstream creates a new source.** The old archive stays, the new one is
ingested as a first-timer, and the wiki receives the same knowledge twice with
no way of knowing it is one.

### "Unchanged" means identical to the archived copy

`isSourceUnchangedSinceIngest` (`workspaceService.ts:564`) compares the byte
size, then the full content, against the archive at the **same path**. Identical
⇒ `unchanged since last ingest`, no LLM call, the source is simply re-archived.

That is correct and efficient. It says nothing about a source that changed name.

### Reconciliation is delegated to the LLM

A modified source goes through ingestion again. The LLM receives the new version
and the related pages, and returns a `create` / `update` / `delete` plan. Every
`update` must carry **the complete final content** of the file.

The engine applies that plan atomically. It does not check that the plan is
consistent with what disappeared from the source: **nothing guarantees a
`delete`**.

### Provenance markers are overwritten on every ingestion

`enforceSourceCitationPath` (`ingestService.ts:108`):

```ts
if (cleanCitationPath === archiveCitationPath) return match;
rewrittenCitations += 1;
return `[src: ${archiveCitationPath}]`;
```

Any `[src: …]` marker that does not designate the **current** source is
rewritten to it. The intent is sound — stopping a model from inventing an
archive path. The side effect is not: since an `update` carries the page's
complete content, **markers inherited from other sources are reattributed to the
source being ingested**.

> This is the most important point in this document. Provenance per claim exists
> in the format, but it is destroyed as soon as a second source touches a page.
> No partial-retraction feature can be built before this is fixed.

### The build is incremental per template, not per dependency

Three fingerprints: `templateHash`, `wikiHash`, `buildContextHash`
(`schema.ts:630`, `buildService.ts:1107`). `refresh` calls
`build({ changedOnly: true })` and skips a deliverable whose three are unchanged.

But `wikiHash` covers the **whole** wiki: an accounting page that moves rebuilds
a networking deliverable.

### Matrix of the actual behaviour

| Event | Wiki | Deliverables |
| --- | --- | --- |
| New source | Creations and updates | Rebuilt if `refreshOnIngest` |
| Identical source | No change | No rebuild |
| Modified source | LLM re-ingestion | Rebuild through a new `wikiHash` |
| Source renamed upstream | **Ingested as new** — duplicate | Rebuild |
| Information removed from a source | Deletion **possible, not guaranteed** | May carry the old content forward |
| Source deleted at the origin | **Not detected** | Potentially stale |
| Wiki page deleted by hand | Deletion applied | Rebuild on the next refresh |
| Template modified | Unchanged | The affected deliverable is rebuilt |
| Build context modified | Unchanged | The affected templates are rebuilt |

---

## 3. The three holes

**(a) Information removed from a source can survive.** The format allows
`{"type":"delete"}` and the engine applies it. But no rule says "this claim came
only from this source, it is gone, it must go". Worse: the page handed over as
context still contains the old fact, which nudges the model into keeping it.

```text
V1: "The server runs PostgreSQL 14."   → wiki: PostgreSQL 14 [src: …]
V2: "The server runs PostgreSQL 16."   → replacement, usually obtained
V2: no mention of PostgreSQL at all    → PostgreSQL 14 can survive indefinitely
```

**(b) A source deleted at the origin is not an event.** `ingest` only handles
what is **present** in `raw/untracked/`. It never compares an upstream inventory
against the ingested one. Removing a page in Confluence therefore triggers
nothing: no deletion of `wiki/sources/…`, no retraction of its claims, no update
to `wiki/index.md`, no rebuild.

**(c) A source's identity does not survive a rename.** See § 2. This hole causes
part of the duplicates currently blamed on categorization.

---

## 4. Decisions

### 4.1 Identity of a source

A source is identified by a **stable `sourceId`, supplied by the producer**, not
by its path:

| Producer | `sourceId` |
| --- | --- |
| CME / Confluence | `confluence:page:<pageId>` |
| Gmail connector | `gmail:message:<messageId>` |
| Manual file drop | `file:<sha256 of the first 4 KB + size>` |

The path becomes an **attribute** of the source, no longer its identity. An
upstream rename updates the path of an existing source; it does not create a new
one.

Transition: sources already ingested, without a `sourceId`, receive one derived
from their current path (`path:<archiveRelativePath>`). They therefore stay
sensitive to renaming until their next ingestion by a producer that can supply
an identifier. **History is not rewritten**; we simply stop creating more of it.

### 4.2 Identity of a concept page

A concept's durable identity is its opaque **`concept_id`**, carried in page
frontmatter. The folder and file path are its current storage and display
labels. A label or language change therefore requires a reviewed path and link
migration; it does not create a new identity. The subject identity is carried
separately by `subject_id` across concept projections.

Two pages that claim one identity must be reconciled without silently dropping
their source evidence. Candidate similarity can surface pages for review, but
labels alone do not authorize a merge.

### 4.3 States of a source, and transitions

```text
                    ┌──────────┐
   first seen ─────►│  active  │◄──── reappears
                    └────┬─────┘
       absent from a     │
       complete export   ▼
                    ┌──────────┐   confirmed by
                    │ missing  │   a 2nd export ──►┌───────────┐
                    └──────────┘                   │ retracted │
                                                   └───────────┘
```

| Observation | Transition | Effect |
| --- | --- | --- |
| Unknown source | → `active` | `ingest` |
| Content differs from the archive | stays `active` | `reconcile` (ingestion) |
| Identical content | stays `active` | `skip` |
| Absent from an export **declared complete** | `active` → `missing` | **report only**, no write |
| `missing` confirmed by a second complete export | → `retracted` | **retraction plan**, subject to approval |
| Reappears | `missing` → `active` | `reconcile` |
| Page with no living source | — | `orphan` warning |

**Two non-negotiable rules:**

1. **A partial export never triggers anything.** Absence is a signal only if the
   caller declares the inventory exhaustive. Without that, a network failure
   during an export would erase half the wiki.
2. **Retraction happens in two beats**: detection and plan, then human
   validation, then application. The plan goes through the same approval
   mechanism as every other Donna mutation — no parallel path.

### 4.4 Granularity of provenance

**Decision: at the level of the claim, not the file.**

A concept page may be supported by several sources. Removing one source does not
delete the page: it removes or re-evaluates **only the claims exclusively
supported by it**.

That requires fixing `enforceSourceCitationPath`:

- a `[src: X]` marker where `X` designates an **existing archive** is left
  untouched, even if `X` is not the current source;
- a marker pointing at a **non-existent** archive is rewritten to the current
  source (the original intent: the model invented a path);
- a marker added by the operation in progress carries the current source.

Without this change, none of the retraction rules in this document is applicable.

### 4.5 Concept folders

- A concept folder is the current storage label under `wiki/concepts/`; its
  durable identity is the opaque `concept_id`, not its path or language.
- Depth is **bounded to two levels** under `wiki/concepts/`. Beyond that the tree
  stops helping the reader and the sorting becomes unreadable.
- New labels are reconciled against a bounded set of relevant established
  concepts and the other proposals in the current plan. The engine validates
  selected identities and rewrites proposed paths; it does not maintain a
  business vocabulary or synonym table.
- A page belongs to **one** concept folder. A subject cited under distinct
  concepts may have one projection in each, connected by its stable
  `subject_id`.
- Changing a concept label or translating it requires a reviewed migration of
  the folder paths and inbound links. The identity remains unchanged.
- An **emptied** category is reported, never deleted automatically: it is a
  filing intention.

### 4.6 Page versions

No application-level history. `historyService` (git) **is** the answer: every
ingestion produces a commit, and going back in time is done with git. Building a
second versioning mechanism would duplicate a capability that is already present
and tested.

---

## 5. What the registry contains

`.wiki/source-registry.json`, written by `ingest`, read by reconciliation.

```json
{
  "version": 1,
  "sources": [
    {
      "sourceId": "confluence:page:12345",
      "archivePath": "raw/ingested/architecture.md",
      "contentHash": "sha256:abc…",
      "status": "active",
      "firstSeenAt": "2026-07-02T09:12:00Z",
      "lastSeenAt": "2026-08-05T10:00:00Z",
      "lastIngestedAt": "2026-08-05T10:00:00Z",
      "producedPages": [
        "wiki/sources/architecture.md",
        "wiki/concepts/infrastructure/postgresql.md"
      ]
    }
  ]
}
```

`producedPages` is filled from the operations actually applied: it is observed
fact, not the model's intention.

---

## 6. Sequencing

| Step | Content | Risk |
| --- | --- | --- |
| **T32.1** | This document | — |
| **T32.2** | Registry, fed by `ingest` — write-only at first; its first reader arrived with OKF v0.2: the ingest stamp reads `producedPages.length` as the page's `sources[].usage_count` | low |
| **T32.3** | `wiki sync --manifest <file>`: compares, **reports** `missing` / `orphan`, does not write | none: read-only |
| **T32.4** | Retraction plan from a confirmed `retracted`, subject to approval | moderate |
| **T32.5** | Provenance per claim (§ 4.4) + marker lint | high: touches ingestion |
| **T32.6** | `wikiHash` per dependency rather than global | isolated, parallelizable |

T32.1 → T32.4 address hole **(b)**. T32.5 addresses **(a)** and gates T33 and
ticket B17. T32.6 is independent.

---

## 7. Still open

No decision is taken here; they are listed so they are not forgotten.

- **Who declares an export complete?** The producer (CME knows whether it
  exported a whole space), or the operator when launching the synchronization?
- **How many exports confirm a disappearance?** Two is an intuition, not a
  measurement.
- **What about a page whose sources are all `retracted` but which has been
  edited by hand since?** Is a manual edit a source?
- **Should the `sourceId` of a hand-dropped file** survive a change to its
  content? If the fingerprint is part of it, no — and a corrected document
  becomes a new source, which is precisely what we are trying to avoid.
