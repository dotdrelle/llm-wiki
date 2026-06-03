---
name: wiki-sync
description: Export all Confluence sources and ingest them into the wiki
params: []
---
Synchronize all Confluence sources into the wiki:

1. Call cme_status. If the result is "not_configured", stop and tell the user to run cme_setup first with their Confluence base URL, username, and personal access token.
2. Call cme_sources_list to display which sources will be exported. If the list is empty, stop and tell the user to add sources with cme_source_add.
3. Call cme_export_run with no source name to export all sources at once.
4. Poll cme_export_status every 30 seconds until status is "success" or "failed". Report progress at each poll.
5. If the export succeeded, call wiki_ingest (via the llm-wiki MCP) to ingest the exported markdown.
6. Report the final outcome: how many sources were exported, any errors, and whether ingest completed.
