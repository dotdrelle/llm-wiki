---
name: wiki-reclassify
description: File unclassified concept pages into the existing grid, then republish the taxonomy
params: []
---
Run the production pipeline steps reclassify-concepts and taxonomy, in that order: file any page currently under `wiki/concepts/unclassified` into it — the concept grid as it already stands, without rebuilding it — then republish the graph taxonomy.

## Boundaries

This workflow never ingests sources and never rebuilds the concept grid. This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the reclassification outcome.
