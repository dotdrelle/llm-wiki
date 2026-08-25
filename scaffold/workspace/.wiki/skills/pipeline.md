---
name: pipeline
description: Run the complete production pipeline while preserving its internally orchestrated DAG
params: []
---
Execute the complete wiki production pipeline for the requested deliverables: ingest, the concept grid, filing unclassified concept pages into it, the graph taxonomy, build, export and polish, in that order. Preserve the production capability's internal planning, concurrency, approvals, progress tracking and terminal reporting; do not decompose these steps into separate delegated intentions. If the request is instead about refreshing Confluence sources, explain that wiki-sync is the appropriate workflow. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the pipeline outcome.
