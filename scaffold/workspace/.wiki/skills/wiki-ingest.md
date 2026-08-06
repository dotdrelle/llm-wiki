---
name: wiki-ingest
description: Ingest the Markdown already waiting in raw/untracked into the wiki, moving it to raw/ingested
params:
  - files
---
Ingest the Markdown sources already staged in the workspace, without fetching anything first (tool calls always use the `server__tool` form).

Requested files: `{files}` — a whitespace-separated list of paths under `raw/untracked/`. When this placeholder is empty, everything pending is ingested.

This skill is the second half of `wiki-sync`, on its own: it assumes the files are already in `raw/untracked/`, whatever put them there — a Confluence export, the documents agent, a manual copy. A successful ingest moves them to `raw/ingested/` and updates the wiki pages.

1. Call llm-wiki__wiki_workspace_status. Its `pendingSources` block is the source of truth for what is waiting under `raw/untracked/`.
2. If `pendingSources.count` is 0, stop and say so plainly. There is nothing to ingest, and starting a job for nothing costs an LLM run and a workspace-write lock. Suggest `wiki-sync` for Confluence sources, or the documents agent for files needing conversion.
3. If files were requested, match each one against `pendingSources.files`, accepting a path with or without its `raw/untracked/` prefix. If any of them resolves to zero or several entries, stop and show the pending list instead of guessing.
4. Show what will be ingested — the file names and their count — and ask the user to approve. Ingesting is a mutating run that rewrites wiki pages.
5. Call production__production_start_job with {"type":"ingest"}. Add `inputs` with the resolved paths when files were requested; omit it to ingest everything pending. Set `confirm:true` only after the user explicitly approves.
6. Note the `jobId`, then poll production__production_job_status every 30 seconds and report the current status and progress fields. A large batch takes a while: ingestion is serialized by a workspace-write lock, so no other job will run meanwhile.
7. Use production__production_job_logs with {"jobId":"...","tail":120} to explain a failure or a phase that looks stuck.
8. Continue until the status is `done`, `failed` or `cancelled`. Then call llm-wiki__wiki_workspace_status again and compare: report how many sources moved out of `pendingSources` into the ingested set, and call llm-wiki__wiki_list_pages if the user wants to see which wiki pages now exist.
9. On failure, say which files are still pending. A failed ingest leaves them in `raw/untracked/`, so the skill can simply be run again once the cause is fixed.
10. Send the optional email notification described below, with the action named "Ingest".

This skill stops at the ingested wiki: it builds nothing. Use `wiki-build` to regenerate deliverables afterwards, then `deliver`. Use `pipeline` when the user wants the whole chain in one job, and `wiki-sync` when the sources still have to be exported from Confluence first.

## Optional email notification

Once the job has reached a terminal state, notify by email — best effort only. Every step below may turn out to be unavailable in the current session; whenever that happens, skip the notification, mention it in one short line, and consider the skill successful. This section must never block, retry or downgrade the result of the job itself.

- Inspect the tools actually available in this session and look for one whose purpose is sending an email or a message. Do not assume any particular server or tool name: whichever mail connector is wired up, use the send tool it exposes, with the parameter names that tool declares. If no such tool is available, skip this section silently — the notification is optional and must never block, retry or change the outcome of the skill.
- Find the recipient in the workspace profile, under its `## Notifications` section. The profile is often already part of your instructions — use it from there. Only if it is absent, and only if a profile-reading tool is available to you, read `.wiki/profile.md` with it; never treat a missing or unreadable profile as an error. If no recipient can be determined either way, ask the user once for an address, and skip the notification if they do not give one.
- Write the email in the reply language already set in your instructions for this workspace — the same language you answer the user in, not the English of the UI. Do not try to read a configuration file to find it. If the profile names a different preferred language for the recipient, that one wins.
- Send a short plain-text summary, at most ten lines: subject `[<workspace>] <action> — <final status>`, body covering what was run, the parameters used, the outcome and duration, the files changed or produced, and the error message if it failed. Link or name files, never paste their content.
- Never include tokens, credentials, API keys or raw log dumps. If the send tool declares a confirmation flag, set it only once the message is ready to go out.
- Then state in the chat whether the notification was sent, skipped (no connector, no recipient) or failed. A failed notification does not change the reported result of the job itself.
