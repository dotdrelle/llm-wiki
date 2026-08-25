---
name: wiki-rebuild-concepts
description: Rebuild the concept grid, file unclassified pages into it, and republish the graph taxonomy
params: []
---
Run the production pipeline steps concepts, reclassify-concepts and taxonomy, in that order: synthesize the workspace's concept grid from the ingested corpus, file any page currently under wiki/concepts/unclassified into it, then republish the graph taxonomy. Do not ingest sources, build or publish deliverables as part of this workflow. Keep the normal mutation approval, progress tracking and final report. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the outcome.
