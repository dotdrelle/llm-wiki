---
name: wiki-rebuild
description: Rebuild the concept pages (folders and leaves) from the archived sources, then verify the workspace links and OKF frontmatter
---
File the archived sources into the wiki: put every archived source back into its concept folder as a leaf, one leaf per concept it belongs to, without touching the archive, then run the workspace verification and report what changed and what the verification found. If a part of the verification cannot run, say so rather than skipping silently.

## Boundaries

This workflow never fetches sources, never reads from raw/untracked, and never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report; the verification runs inside the same job and needs no approval of its own.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the outcome.
