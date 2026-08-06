---
name: new-template
description: Draft a new deliverable template from what the wiki actually contains, with its build-context selection
params:
  - family
  - intent
---
Design and write one new template under `templates/`, derived from the current wiki (tool calls always use the `server__tool` form).

Requested family: `{family}` — the sub-directory of `templates/` the template belongs to. When this placeholder is empty, propose one from the wiki structure and have the user confirm it.
Requested intent: `{intent}` — what the deliverable is for and who reads it. When empty, ask once, in one short question, before going further.

This skill never builds anything. It writes files and stops.

## A. Frame the template — no writing in this phase

1. Call llm-wiki__wiki_outline. Treat its communities as the candidate sections: their `documentCount` and `topPages` tell you where the wiki holds material. If it returns `degenerate: true`, stop and say the wiki has no usable structure yet — recommend an ingest instead of inventing sections.
2. Call llm-wiki__template_read with no path to list existing templates, and read any that is close to the request. Do not duplicate an existing template; propose amending it instead when that is the honest answer.
3. Read the workspace profile for tone, language and audience conventions. It is usually already part of your instructions.
4. Call llm-wiki__wiki_collect_context on the two or three communities you intend to build sections on, to check they really support the sections you have in mind. A section nobody can source is a section that will render "evidence missing" at build time.
5. List the available rules with llm-wiki__wiki_workspace_status, and read the relevant ones under `build-context/` before deciding which apply.

Then present, in chat, a **template plan**: proposed path under `templates/{family}/`, `output` path, and for each section — its title, one sentence of intent, and the community or pages that anchor it. Finish with the `build_context` list you intend to declare, and say plainly which of those files already exist. Mark any section you could not anchor; do not hide it.

## B. Get the plan approved

Ask the user to confirm or amend the plan. Amend and re-present as many times as they want. This is the cheap moment to be wrong — a plan is twelve lines, a template is two hundred.

Do not write anything until they approve.

## C. Write

1. If a rule genuinely missing from the workspace was agreed in the plan, write it first with llm-wiki__build_context_write. Order matters: a template that references a file which does not exist yet loses that context at build time with only a warning. Read the `invalidatesOnNextBuild` field it returns and report it — adding a shared rule makes every template without a `build_context` list stale.
2. Write the template with llm-wiki__template_write. Always include an explicit `build_context` key, even empty (`[]`); without it the template silently inherits every file in `build-context/`, including rules written for other deliverables.
3. Both tools return a preview first. Read the preview, check `buildContext.resolved` and `buildContext.missing`, and only then re-call with `confirm: true`. If `missing` is not empty, fix the paths rather than confirming.
4. If a tool answers `PRODUCTION_JOB_ACTIVE`, a build or ingest is running: do not retry in a loop. Report which job holds the workspace and offer to wait or to cancel it.

## Template writing rules

- Every generated section is one `[[INSTRUCTION: ...]]` slot. Write the instruction so it names what to look for and from which part of the wiki, not just a topic.
- Instructions must demand only what the wiki can support, and require citations in `[src: wiki/...]` form.
- Keep the frontmatter to `title`, `output`, `description` and `build_context`.
- `output` reproduces the family, so `deliverables/` mirrors `templates/`.
- Watch the total size of the selected `build_context` against `maxChars` in the preview: past the cap the end of the context is silently cut.

## Closing

State where the template was written, which context files it selects, and any section left unanchored. Then say — without doing it — that the deliverable is produced by `wiki-build` with this template, and that the first build will cost a full LLM run.
