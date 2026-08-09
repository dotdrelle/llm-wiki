---
name: diagnose
description: Diagnose workspace configuration and prioritize concrete remedies
params: []
---
Run a complete read-only diagnostic of the wiki workspace, explain every error and warning in plain language, and finish with prioritized concrete remedies. Pay particular attention to provider connectivity, context and batch sizing, vector indexing, and unsafe fill ratios. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort summary in the reply language; otherwise skip notification silently, and never let notification failure change the diagnostic outcome.
