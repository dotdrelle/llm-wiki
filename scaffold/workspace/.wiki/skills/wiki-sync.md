---
name: wiki-sync
description: Export Confluence sources and then ingest the exported Markdown
params:
  - source
---
Export the requested Confluence source, or all configured sources when none is specified. Check configuration and source availability first, wait for the export to finish, and stop without producing partial input if it fails or exports nothing.

Then run the production pipeline over the newly exported Markdown: ingest it into the wiki, refresh the concept grid, file any unclassified concept pages into it, and republish the graph taxonomy — steps ingest, concepts, reclassify-concepts, taxonomy, in that order. Do not build or publish deliverables as part of this workflow. Keep the normal mutation approval, progress tracking and final report. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the synchronization outcome.
