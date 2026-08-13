---
name: wiki-build
description: Build deliverables from the current wiki for one template or all templates
params:
  - template
---
Build deliverables from the current wiki within the exact scope requested by the `template` parameter.

When `template` is non-empty, treat it as a strict selector. Resolve only templates whose family, relative path, or file name matches that value. Never widen a non-empty selector to every applicable template. For example, `template: overview` means templates under `templates/overview/`, not templates from other families.

Only when `template` is genuinely empty may every applicable template be built. Resolve templates without guessing, use stable rebuilding when existing outputs permit it, obtain the normal mutation approval, preserve the build capability's internal plan, and report produced files and failures. Do not ingest sources or publish the deliverables. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the build outcome.
