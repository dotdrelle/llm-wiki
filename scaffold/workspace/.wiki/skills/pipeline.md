---
name: pipeline
description: Run the production pipeline (ingest -> build -> export -> polish)
params: []
---
Launch the full production pipeline via the wiki-production agent:

This skill is for wiki production steps only. If the user asks to export from
Confluence, refresh Confluence data, or sync sources, use the `wiki-sync` skill
and CME tools instead.

1. Identify the target deliverables from the user request, or call `production__production_list_templates` and use the matching `deliverable` values.
2. If the user asks to ingest multiple known source files, decompose it as normal plan tasks: one or more parallel `production__production_start_job` calls with `{"type":"ingest_plan","inputs":["..."],"confirm":true}`, then one convergence task calling `{"type":"ingest_apply","inputs":[".wiki/ingest-plans/..."],"confirm":true}` with the plan files produced by the plan jobs. Do not ask the user to run these internal phases manually.
3. For the full production pipeline, call `production__production_start_job` on the `production` MCP server with `{"type":"pipeline","steps":["ingest","build","export","polish"],"deliverables":["..."],"stabilize":true}` when deliverables already exist and content stability matters. Omit `stabilize` or set it to `false` for first builds. Set `confirm:true` only after the user explicitly approves the mutating run.
4. Note the `jobId` returned.
5. Poll `production__production_job_status` with that `jobId` every 30 seconds. Report the current status and any progress fields returned.
6. When useful, call `production__production_job_logs` with `{"jobId":"...","tail":120}` to explain failures or long-running phases.
7. Continue polling until the job status is `done`, `failed`, or `cancelled`.
8. Report the final outcome: total duration, errors if any, and where deliverables were produced.

Do not call legacy `wiki_pipeline_run` or `wiki_job_status`; these are not the current production MCP tool names.
