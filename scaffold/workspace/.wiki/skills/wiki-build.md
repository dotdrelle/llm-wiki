---
name: wiki-build
description: Build deliverables from the current wiki for one template or all templates
params:
  - template
---
Build deliverables from the current wiki within the exact scope requested by the `template` parameter.

## Selector

A non-empty `template` is a strict selector: resolve only templates whose family, relative path, or file name matches that value, and never widen it to every applicable template. For example, `template: overview` means templates under `templates/overview/`, not templates from other families. Every applicable template may be covered only when `template` is genuinely empty.

## Execution

Resolve templates without guessing, use stable rebuilding when existing outputs permit it, obtain the normal mutation approval, preserve the build capability's internal plan, and report produced files and failures.

## Boundaries

This workflow never ingests sources and never publishes the deliverables.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the build outcome.
