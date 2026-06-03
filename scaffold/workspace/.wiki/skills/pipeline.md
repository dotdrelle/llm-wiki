---
name: pipeline
description: Run the production pipeline (ingest -> build -> export)
params: []
---
Launch the full production pipeline via the wiki-production agent:

This skill is for wiki production steps only. If the user asks to export from
Confluence, refresh Confluence data, or sync sources, use the `wiki-sync` skill
and CME tools instead.

1. Call `production_start_job` on the `production` MCP server with `{"type":"pipeline","steps":["ingest","build","export"]}`. Set `confirm:true` only after the user explicitly approves the mutating run.
2. Note the `jobId` returned.
3. Poll `production_job_status` with that `jobId` every 30 seconds. Report the current status and any progress fields returned.
4. When useful, call `production_job_logs` with `{"jobId":"...","tail":120}` to explain failures or long-running phases.
5. Continue polling until the job status is `done`, `failed`, or `cancelled`.
6. Report the final outcome: total duration, errors if any, and where deliverables were produced.

Do not call legacy `wiki_pipeline_run` or `wiki_job_status`; these are not the current production MCP tool names.
