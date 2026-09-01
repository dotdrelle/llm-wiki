---
name: wiki-sync
description: Export all configured Confluence sources and then ingest the exported Markdown
---
Export every configured Confluence source exactly as the connector is currently configured. Never ask which source to export, and never change, re-enter or reconfigure the existing credentials: use the current configuration as it is. Check configuration and source availability first, wait for the export to finish, and stop without producing partial input if it fails or exports nothing. When the connector is not configured, stop and report that state instead of asking for credentials.

Then run the production pipeline step ingest over the newly exported Markdown. During the ingest every source is filed as a concept leaf under `wiki/concepts/<concept>/<subject>.md` — the concept is the folder, so no separate concept or taxonomy pass exists anymore.

## Boundaries

This workflow never builds, exports, polishes or publishes deliverables.

## Execution

Keep the normal mutation approval, progress tracking and final report.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the synchronization outcome.
