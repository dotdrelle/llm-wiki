---
name: pipeline
description: Run the production pipeline (ingest -> build -> export -> polish)
params: []
---
Launch the full production pipeline via the wiki-production agent:

This skill is for wiki production steps only. If the user asks to export from
Confluence, refresh Confluence data, or sync sources, use the `wiki-sync` skill
and CME tools instead.

1. Identify the target deliverables from the user request, or call `production_list_templates` and use the matching `deliverable` values.
2. Call `production_start_job` on the `production` MCP server with `{"type":"pipeline","steps":["ingest","build","export","polish"],"deliverables":["..."],"stabilize":true}` when deliverables already exist and content stability matters. Omit `stabilize` or set it to `false` for first builds. Set `confirm:true` only after the user explicitly approves the mutating run.
3. Note the `jobId` returned.
4. Poll `production_job_status` with that `jobId` every 30 seconds. Report the current status and any progress fields returned.
5. When useful, call `production_job_logs` with `{"jobId":"...","tail":120}` to explain failures or long-running phases.
6. Continue polling until the job status is `done`, `failed`, or `cancelled`.
7. Report the final outcome: total duration, errors if any, and where deliverables were produced.

Do not call legacy `wiki_pipeline_run` or `wiki_job_status`; these are not the current production MCP tool names.
