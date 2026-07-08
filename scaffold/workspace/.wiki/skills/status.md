---
name: status
description: Check all MCP services and running jobs in one shot
params: []
---
Check the status of all available services in this order:

1. If the CME connector (cme__cme_status) is available, call it. Report whether it is configured or not.
2. If the production connector is available, call `production__production_list_jobs` to list recent jobs. Report running jobs, pending jobs, and any recent failures.
3. Summarize what is up and operational, what is missing or misconfigured, and whether any action is needed.

Keep the summary concise: one line per service, then a short conclusion.
