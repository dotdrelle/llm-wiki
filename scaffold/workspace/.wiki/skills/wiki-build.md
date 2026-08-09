---
name: wiki-build
description: Build deliverables from the current wiki for one template or all templates
params:
  - template
---
Build the requested deliverable template, or every applicable template when none is specified, from the current wiki. Resolve templates without guessing, use stable rebuilding when existing outputs permit it, obtain the normal mutation approval, preserve the build capability's internal plan, and report produced files and failures. Do not ingest sources or publish the deliverables. If a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language; otherwise skip notification silently, and never let notification failure change the build outcome.
