---
name: wiki-taxonomy
description: Republish the graph taxonomy from the current wiki content
params: []
---
Run the production pipeline step taxonomy only: republish the graph taxonomy from the wiki as it currently stands, without touching the concept grid. Do not ingest sources, rebuild or refile the concept grid, build or publish deliverables as part of this workflow. Keep the normal mutation approval, progress tracking and final report. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the outcome.
