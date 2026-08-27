---
name: wiki-taxonomy
description: Republish the graph taxonomy from the current wiki content
params: []
---
Run the production pipeline step taxonomy only: republish the graph taxonomy from the wiki as it currently stands, without touching the concept grid.

## Boundaries

This workflow never ingests sources and never rebuilds or refiles the concept grid. This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the taxonomy outcome.
