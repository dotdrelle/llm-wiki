---
name: deliver
description: Publish existing deliverables, optionally with polish
params:
  - template
  - polish
---
Publish the requested existing deliverable, or all existing deliverables when none is specified, using polish mode when requested. Resolve names without guessing, refuse targets that have not been built, obtain the normal mutation approval, preserve the delivery capability's internal execution plan, and report the exact published files and any failure. This workflow never fetches sources or builds missing deliverables. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the delivery outcome.
