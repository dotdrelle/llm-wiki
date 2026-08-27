---
name: status
description: Summarize connector health and current or recent jobs
execution: direct
params: []
---
Inspect the available services and recent jobs without mutating anything, then give a concise status summary identifying what is operational, missing, misconfigured, running or recently failed.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the status outcome.
