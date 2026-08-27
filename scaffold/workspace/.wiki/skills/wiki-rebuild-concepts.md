---
name: wiki-rebuild-concepts
description: Rebuild the concept grid, file unclassified pages into it, and republish the graph taxonomy
params: []
---
Run the production pipeline steps concepts, reclassify-concepts and taxonomy, in that order: synthesize the workspace's concept grid from the ingested corpus, file any page currently under `wiki/concepts/unclassified` into it, then republish the graph taxonomy.

## Boundaries

This workflow never ingests sources. This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the rebuild outcome.
