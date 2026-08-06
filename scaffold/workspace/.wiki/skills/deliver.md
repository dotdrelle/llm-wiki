---
name: deliver
description: Export built deliverables, optionally with polish (usage: /deliver [template] [polish])
params:
  - template
  - polish
---
Export — that is, publish — existing llm-wiki deliverables from `deliverables/`, optionally in polish mode (tool calls always use the `server__tool` form).

Requested template: `{template}` — requested mode: `{polish}`.

1. Read the two placeholders above. If the first one is one of `polish`, `--polish`, `true` or `yes`, treat it as the mode and consider that no template was requested. Otherwise the first is the template and the second selects polish mode when it is `polish`, `--polish`, `true` or `yes`.
2. Call production__production_list_templates. Resolve the requested template against the returned entries, accepting the name with or without its `.md` extension and matching either the `template` value or the `deliverable` value. If it resolves to zero or several entries, stop and show the available names instead of guessing.
3. If no template was requested, target every deliverable that exists, and confirm that scope with the user before starting.
4. If a targeted deliverable does not exist yet (`deliverableExists:false`, or absent from the deliverables list), stop and tell the user to run the `wiki-build` skill first. This job publishes existing deliverables; it never generates them.
5. Call production__production_start_job with {"type":"polish"} in polish mode, or {"type":"export"} otherwise, passing `deliverables` with the resolved deliverable paths. Set `confirm:true` only after the user explicitly approves this mutating run.
6. Note the `jobId`, then poll production__production_job_status every 30 seconds and report the current status.
7. Use production__production_job_logs with {"jobId":"...","tail":120} to explain failures or long-running phases.
8. Continue until the status is `done`, `failed` or `cancelled`, then report the outcome: duration, errors, and the exact paths of the published files.
9. Send the optional email notification described below, with the action named "Export" or "Polish" depending on the mode used.

This is not a source export: to pull content out of Confluence, use the `wiki-sync` skill and the CME tools instead.

## Optional email notification

Once the job has reached a terminal state, notify by email — best effort only. Every step below may turn out to be unavailable in the current session; whenever that happens, skip the notification, mention it in one short line, and consider the skill successful. This section must never block, retry or downgrade the result of the job itself.

- Inspect the tools actually available in this session and look for one whose purpose is sending an email or a message. Do not assume any particular server or tool name: whichever mail connector is wired up, use the send tool it exposes, with the parameter names that tool declares. If no such tool is available, skip this section silently — the notification is optional and must never block, retry or change the outcome of the skill.
- Find the recipient in the workspace profile, under its `## Notifications` section. The profile is often already part of your instructions — use it from there. Only if it is absent, and only if a profile-reading tool is available to you, read `.wiki/profile.md` with it; never treat a missing or unreadable profile as an error. If no recipient can be determined either way, ask the user once for an address, and skip the notification if they do not give one.
- Write the email in the reply language already set in your instructions for this workspace — the same language you answer the user in, not the English of the UI. Do not try to read a configuration file to find it. If the profile names a different preferred language for the recipient, that one wins.
- Send a short plain-text summary, at most ten lines: subject `[<workspace>] <action> — <final status>`, body covering what was run, the parameters used, the outcome and duration, the files changed or produced, and the error message if it failed. Link or name files, never paste their content.
- Never include tokens, credentials, API keys or raw log dumps. If the send tool declares a confirmation flag, set it only once the message is ready to go out.
- Then state in the chat whether the notification was sent, skipped (no connector, no recipient) or failed. A failed notification does not change the reported result of the job itself.
