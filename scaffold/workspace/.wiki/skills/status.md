---
name: status
description: Summarize connector health and current or recent jobs
execution: direct
params: []
---
Inspect the available services and recent jobs without mutating anything, then give a concise status summary identifying what is operational, missing, misconfigured, running or recently failed. If a messaging connector and a notification recipient from the workspace profile are available, send that short summary in the reply language as a best-effort notification; otherwise skip notification silently, and never let notification failure change the status outcome.
