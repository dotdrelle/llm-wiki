---
name: wiki-ingest
description: Ingest Markdown already waiting in raw/untracked into the wiki
params:
  - files
---
Ingest the requested staged Markdown files, or everything pending when no files are specified, into the wiki. Validate the pending inputs before mutation, obtain the normal approval, preserve the production capability's internal execution plan, and report the moved sources, changed wiki pages and any remaining inputs. Do not fetch sources, build, export or polish deliverables. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the ingest outcome.
