---
name: curate
description: Curate the wiki — find duplicate, disagreeing, outdated or unsourced pages and propose corrections on a branch a human merges or discards
---
Curate the wiki: find duplicate pages, pages that disagree or repeat each other, outdated or superseded pages, and claims with no cited source, then write the corrections on a dedicated branch. A human decides whether to keep them: never merge, publish or delete anything yourself.

## Boundaries

This workflow never fetches sources, never ingests, never builds, exports or publishes a deliverable, and never writes the wiki directly — its only output is a reviewable branch.

## Execution

Obtain the normal mutation approval, keep the curation capability's own analysis sequence, and list the changed files and the objections it could not resolve.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the curation outcome.
