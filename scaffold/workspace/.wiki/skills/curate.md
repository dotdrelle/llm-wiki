---
name: curate
description: Curate the wiki — find duplicate, disagreeing, outdated or unsourced pages and propose corrections on a branch a human merges or discards
---
Curate the wiki: find duplicate pages, pages that disagree or repeat each other, outdated or superseded pages, and claims with no cited source, then write the corrections on a dedicated branch. A human decides whether to keep them: never merge, publish or delete anything yourself.

## Boundaries

This workflow never fetches sources, never ingests, never builds, exports or publishes a deliverable, and never writes the wiki directly — its only output is a reviewable branch.

## Execution

Run the curation analysis and prepare a reviewable proposal on its dedicated branch. The human approval is the later merge or discard on the Agent proposals page; do not request a separate pre-run mutation approval. List the changed files and the objections the review could not resolve.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the curation outcome.
