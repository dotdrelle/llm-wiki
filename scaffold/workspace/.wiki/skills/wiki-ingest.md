---
name: wiki-ingest
description: Ingest Markdown already waiting in raw/untracked into the wiki
params:
  - files
---
Ingest the requested staged Markdown files, or everything pending when no files are specified, through the single TAXO operation. It splits each source into evidence-bearing section fiches under `wiki/sources/`, assigns tags and regenerates tag-family pivots under `wiki/concepts/`. Obtain the normal approval once for the complete operation and report the sources, fiches and pivots written, skipped sections, warnings and any remaining inputs. Do not create separate analysis, write, regroup or taxonomy tasks.

## Boundaries

This workflow never fetches sources. This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the ingest outcome.
