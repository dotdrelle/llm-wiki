---
name: new-template
description: Design and write one evidence-grounded deliverable template
execution: direct
params:
  - family
  - intent
---
Design one evidence-grounded deliverable template for the requested family and intent. Ground it in the current wiki structure, existing templates, workspace profile, and applicable build context.

## Workflow

Start from the complete empty template shown below. Adapt its title, description, section headings, and instruction text to the user's request. Keep every requested section anchored in available material, and identify any section that cannot be anchored.

Do not build the resulting deliverable.

## Document type and location

The requested artifact is a deliverable template, never a wiki page.

Its path must start exactly with `templates/`. The `templates/` directory is a workspace root directory, parallel to `wiki/`; it is not inside `wiki/`.

Correct path: `templates/overview/example.md`.

Incorrect path: `wiki/templates/overview/example.md`.

Never create or update any file under `wiki/` while running this skill. If writing under `templates/` is unavailable, stop and report that the template could not be created. Do not fall back to creating a wiki page.

Creating a template never means building it. Never start a build, generate a deliverable, export, publish, or process any other template. Stop after the requested template file has been written and verified.

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

Copy this complete structure into the new file. Replace the uppercase labels with the requested content and repeat the section block until every requested section is covered.

The written template must contain only frontmatter, headings, and multiline `[[INSTRUCTION: ...]]` blocks. Static placeholder prose, ellipses (`...`), empty tables, bare source paths, and prewritten factual content are forbidden.

The only valid generation slot is `[[INSTRUCTION: ...]]`. The only valid citation marker is `[src: wiki/path.md]`. Never use `{{cite:...}}`, `{{> ...}}`, Handlebars, includes, `> Source: ...`, or another invented syntax.

## Completion

Before reporting success, verify the written template itself. Report the actual written path and any unanchored section.

## Approval

Prepare the complete template before requesting approval. When approval is required, keep the pending creation as the next action instead of ending with a prose-only plan. Never ask the user to relaunch the skill. Do not report success unless the requested file was actually written.

A notification is optional. When messaging and a notification recipient are available, send a short best-effort terminal summary in the reply language. Otherwise skip it silently, and never let notification failure change the template-authoring outcome.
