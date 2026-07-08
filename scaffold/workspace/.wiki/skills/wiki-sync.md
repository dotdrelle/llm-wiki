---
name: wiki-sync
description: Export all Confluence sources and ingest them into the wiki
params: []
---
Synchronize all Confluence sources into the wiki (tool calls always use the `server__tool` form):

1. Call cme__cme_status. If the result is "not_configured", stop and tell the user to run cme__cme_setup first with their Confluence base URL, username, and personal access token.
2. Call cme__cme_sources_list to display which sources will be exported. If the list is empty, stop and tell the user to add sources with cme__cme_source_add.
3. Call cme__cme_export_run with no source name to export all sources at once.
4. Poll cme__cme_export_status every 30 seconds until status is "success" or "failed". Report progress at each poll.
5. If the export succeeded, call production__production_start_job on the production MCP server with {"type":"ingest"} to ingest the exported markdown. Use production__production_job_status to follow the job until it is done or failed.
6. Report the final outcome: how many sources were exported, any errors, and whether ingest completed.
