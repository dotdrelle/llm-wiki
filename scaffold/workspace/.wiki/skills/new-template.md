---
name: new-template
description: Author one instruction-only deliverable template — never build, export or publish it
execution: direct
params:
  - family
  - intent
---
Design one evidence-grounded deliverable template for the requested family and intent, grounded in the current wiki structure, existing templates, workspace profile, and applicable build context.

## Workflow

Start from the complete empty template shown below. Adapt its title, description, section headings, and instruction text to the user's request, keep every requested section anchored in available material, and identify any section that cannot be anchored.

## What this skill never does

Do not build the resulting deliverable. Creating a template never means building it: never start a build, generate a deliverable, export, publish, or process any other template. Stop after the requested template file has been written and verified.

## Where the file goes

Never create or update any file under `wiki/` while running this skill. The requested artifact is a deliverable template, never a wiki page, and its path must start exactly with `templates/` — a workspace root directory, parallel to `wiki/`, not inside it.

The path is deterministic, derived from the parameters — never invented. The file name is the `intent` parameter, slugified (lowercase, words separated by hyphens, at most four words, never a `.md` suffix added twice); the subfolder is the `family` parameter, slugified the same way. When `family` is absent or empty, write directly at the root of `templates/`.

Correct paths: `family=overview, intent=example` → `templates/overview/example.md`; no family, `intent=project overview` → `templates/project-overview.md`.

Incorrect path: `wiki/templates/overview/example.md`.

If writing under `templates/` is unavailable, stop and report that the template could not be created, without falling back to a wiki page.

## Empty template to copy and adapt

```markdown
---
title: "DELIVERABLE TITLE"
description: "PURPOSE OF THIS DELIVERABLE"
build_context: [build-context/rules/citations.md, build-context/rules/writing-style.md, build-context/quality/gaps-and-review.md]
---

# DELIVERABLE TITLE

## FIRST REQUESTED SECTION

[[INSTRUCTION:
Describe precisely what this section must contain.
Use only the available wiki context.
Cite every factual claim with [src: wiki/path.md].
]]

## NEXT REQUESTED SECTION

[[INSTRUCTION:
Describe precisely what this section must contain.
Use only the available wiki context.
Cite every factual claim with [src: wiki/path.md].
]]
```

## How to use that structure

Copy this complete structure into the new file, replacing the uppercase labels with the requested content and repeating the section block until every requested section is covered.

## Allowed content

The written template must contain only frontmatter, headings, and multiline `[[INSTRUCTION: ...]]` blocks. Static placeholder prose, ellipses (`...`), empty tables, bare source paths, and prewritten factual content are forbidden.

## Instruction blocks

Every section's prompt must be encapsulated in exactly one `[[INSTRUCTION: ...]]` block: the block opens on its own line with `[[INSTRUCTION:` and closes on its own line with `]]`, with the entire instruction text between them. Never leave an instruction bare under a heading, never drop the closing `]]`, and never write the prompt outside the block.

## Allowed syntax

The only valid generation slot is `[[INSTRUCTION: ...]]`. The only valid citation marker is `[src: wiki/path.md]`. Never use `{{cite:...}}`, `{{> ...}}`, Handlebars, includes, `> Source: ...`, or another invented syntax.

## Completion

The file must actually exist on disk before success is reported — a preview, a plan, or a pending approval is not a write. Verify the written template itself, then report the actual written path, the complete front-matter YAML you wrote (the `title`, `description`, and `build_context` entries, verbatim), and any unanchored section.

## Approval

Prepare the complete template before requesting approval. When approval is required, keep the pending creation as the next action instead of ending with a prose-only plan. Never ask the user to relaunch the skill, and never report success unless the requested file was actually written.

## Notification

When a messaging connector and a notification recipient from the workspace profile are available, send a short best-effort terminal summary in the reply language. Otherwise skip the notification silently, and never let a notification failure change the template-authoring outcome.
