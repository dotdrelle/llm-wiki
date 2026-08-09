---
name: wiki-sync
description: Export Confluence sources and then ingest the exported Markdown
params:
  - source
---
Export the requested Confluence source, or all configured sources when none is specified. Check configuration and source availability first, wait for the export to finish, and stop without producing partial input if it fails or exports nothing.

Then ingest the newly exported Markdown into the wiki, with the normal mutation approval, progress tracking and final report. Do not build or publish deliverables as part of this workflow. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the synchronization outcome.
