---
name: wiki-sync
description: Export Confluence sources and then ingest the exported Markdown
params:
  - source
---
Export the requested Confluence source, or all configured sources when none is specified. Check configuration and source availability first, wait for the export to finish, and stop without producing partial input if it fails or exports nothing.

Then run the production pipeline over the newly exported Markdown — steps ingest, concepts, reclassify-concepts and taxonomy, in that order: ingest it into the wiki, refresh the concept grid, file any page currently under `wiki/concepts/unclassified` into it, then republish the graph taxonomy.

## Boundaries

This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the synchronization outcome.
