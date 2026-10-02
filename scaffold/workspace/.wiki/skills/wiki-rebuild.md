---
name: wiki-rebuild
description: Rebuild TAXO fiches and tag-family pivots from archived sources, then verify links and OKF frontmatter
capability: knowledge.rebuild
operation: ingest_rebuild
---
Re-run the single TAXO operation over every archived source without touching the archives. Recreate or update evidence-bearing section fiches under `wiki/sources/`, regenerate tag-family pivots under `wiki/concepts/`, then run workspace verification and report what changed and what it found. Do not split analysis, writes and regrouping into separate tasks. If part of the operation or verification fails or degrades, say so rather than skipping silently.

## Boundaries

This workflow never fetches sources, never reads from raw/untracked, and never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report; the verification runs inside the same job and needs no approval of its own.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the outcome.
