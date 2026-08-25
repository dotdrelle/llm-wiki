---
name: wiki-reclassify
description: File unclassified concept pages into the existing grid, then republish the taxonomy
params: []
---
Run the production pipeline steps reclassify-concepts and taxonomy, in that order: file any page currently under wiki/concepts/unclassified into the existing concept grid, without rebuilding the grid itself, then republish the graph taxonomy. Do not ingest sources, rebuild the concept grid, build or publish deliverables as part of this workflow. Keep the normal mutation approval, progress tracking and final report. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the outcome.
