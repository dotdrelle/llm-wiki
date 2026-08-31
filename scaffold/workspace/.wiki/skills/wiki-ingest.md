---
name: wiki-ingest
description: Ingest Markdown already waiting in raw/untracked into the wiki
params:
  - files
---
Ingest the requested staged Markdown files, or everything pending when no files are specified, into the wiki. Validate the pending inputs before mutation, obtain the normal approval, preserve the production capability's internal execution plan, and report the moved sources, changed wiki pages and any remaining inputs. During the ingest every source is filed as a concept leaf under `wiki/concepts/<concept>/<subject>.md` — the concept is the folder, so the concept map updates with the ingestion itself.

## Boundaries

This workflow never fetches sources. This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the ingest outcome.
