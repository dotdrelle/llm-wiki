---
name: pipeline
description: Run the whole production chain in one go, from ingest to polish
params: []
---
Execute the complete wiki production pipeline for the requested deliverables: ingest, the concept grid, filing unclassified concept pages into it, the graph taxonomy, build, export and polish, in that order.

## Indivisibility

Preserve the production capability's internal planning, concurrency, approvals, progress tracking and terminal reporting. These steps are one business operation and must never be decomposed into separate delegated intentions.

## Not this workflow

A request about refreshing Confluence sources belongs to wiki-sync; say so instead of running this pipeline.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the pipeline outcome.
