---
name: deliver
description: Publish existing deliverables, with or without polishing
params:
  - deliverable
  - polish
---
Publish the requested existing deliverable, or every existing deliverable when none is specified. Resolve names without guessing and refuse any target that has not been built.

## Polishing

The `polish` parameter selects the form of the publication: when it asks for polishing, the resolved deliverables go out through the polishing variant, which improves their form on the way out; when it is absent, they go out as they stand.

## Boundaries

This workflow never fetches sources and never builds a missing deliverable.

## Execution

Obtain the normal mutation approval, preserve the publishing capability's internal execution plan, and report the exact published files and any failure.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the publication outcome.
