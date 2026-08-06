---
name: wiki-build
description: Build deliverables from the current wiki content, for one template or all of them
params:
  - template
---
Build llm-wiki deliverables from the templates and the current wiki content, through the production agent (tool calls always use the `server__tool` form).

Requested template: `{template}` — when this placeholder is empty, every applicable template is built.

1. Call production__production_list_templates. Use the returned `template`, `deliverable` and `deliverableExists` fields as the source of truth.
2. If a template was requested, resolve it against that list, accepting the name with or without its `.md` extension, and matching either the `template` value or the `deliverable` value. If it resolves to zero or several entries, stop and show the available templates instead of guessing.
3. Call production__production_start_job with {"type":"build"}. Add `templates` with the resolved template path when one was requested; omit it to build everything.
4. Add `"stabilize":true` when every targeted deliverable already exists (`deliverableExists:true`), so the rebuild stays deterministic and preserves stable content. Omit `stabilize` for a first build, and honour any explicit instruction from the user over this rule.
5. Set `confirm:true` only after the user explicitly approves this mutating run.
6. Note the `jobId`, then poll production__production_job_status every 30 seconds and report the current status and progress fields.
7. Use production__production_job_logs with {"jobId":"...","tail":120} to explain failures or long-running phases.
8. Continue until the status is `done`, `failed` or `cancelled`, then report the outcome: duration, errors, and which files were written under `deliverables/`.
9. Send the optional email notification described below, with the action named "Build".

This skill does not ingest anything: it builds from the wiki as it currently stands. Run `wiki-sync` first if the sources changed, and `deliver` afterwards to export or polish the result.

## Optional email notification

Once the job has reached a terminal state, notify by email — best effort only. Every step below may turn out to be unavailable in the current session; whenever that happens, skip the notification, mention it in one short line, and consider the skill successful. This section must never block, retry or downgrade the result of the job itself.

- Inspect the tools actually available in this session and look for one whose purpose is sending an email or a message. Do not assume any particular server or tool name: whichever mail connector is wired up, use the send tool it exposes, with the parameter names that tool declares. If no such tool is available, skip this section silently — the notification is optional and must never block, retry or change the outcome of the skill.
- Find the recipient in the workspace profile, under its `## Notifications` section. The profile is often already part of your instructions — use it from there. Only if it is absent, and only if a profile-reading tool is available to you, read `.wiki/profile.md` with it; never treat a missing or unreadable profile as an error. If no recipient can be determined either way, ask the user once for an address, and skip the notification if they do not give one.
- Write the email in the reply language already set in your instructions for this workspace — the same language you answer the user in, not the English of the UI. Do not try to read a configuration file to find it. If the profile names a different preferred language for the recipient, that one wins.
- Send a short plain-text summary, at most ten lines: subject `[<workspace>] <action> — <final status>`, body covering what was run, the parameters used, the outcome and duration, the files changed or produced, and the error message if it failed. Link or name files, never paste their content.
- Never include tokens, credentials, API keys or raw log dumps. If the send tool declares a confirmation flag, set it only once the message is ready to go out.
- Then state in the chat whether the notification was sent, skipped (no connector, no recipient) or failed. A failed notification does not change the reported result of the job itself.
