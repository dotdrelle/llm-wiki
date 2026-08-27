---
name: diagnose
description: Diagnose workspace configuration and prioritize concrete remedies
params: []
---
Run a complete read-only diagnostic of the wiki workspace, explain every error and warning in plain language, and finish with prioritized concrete remedies.

## Focus

Pay particular attention to provider connectivity, context and batch sizing, vector indexing, and unsafe fill ratios.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the diagnostic outcome.
