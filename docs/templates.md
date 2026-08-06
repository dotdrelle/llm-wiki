# Templates and deliverables

## Template format

Templates are standard markdown files with optional YAML frontmatter.

Recognized frontmatter keys:

| Key             | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `title`         | Kept in the generated markdown frontmatter                             |
| `output`        | Output path relative to `deliverables/`                                |
| `description`   | Template-only metadata, stripped from output                           |
| `build_context` | Optional list of context files; template-only and stripped from output |

Example:

```md
---
title: Project Brief
output: briefs/project-brief.md
description: High-level summary for stakeholders
---

# Project Brief

## Executive Summary

[[INSTRUCTION: Produce a concise executive summary using only facts documented in the wiki. Cite claims with [src: ...].]]

## Scope

[[INSTRUCTION: List the project scope items documented in the wiki, grouped by domain. One bullet per item.]]
```

Each `[[INSTRUCTION: ...]]` slot is replaced at build time by a markdown fragment produced from wiki context. Multiple slots can share one LLM call, up to `build.slotBatchSize`, but prompt limits can split batches earlier. Use `wiki build --plan` to see the exact batches and estimated input tokens before generating content.

## Prompt rules

The build prompt enforces these constraints:

- use only information present in the wiki context
- cite factual claims with `[src: wiki/sources/file.md]`
- if the wiki is missing evidence for a slot, say so explicitly
- do not fill gaps with speculation

## Build context

Fixed context files in `build-context/` are included verbatim, up to
`build.maxBuildContextChars`. A template without `build_context` inherits every
context file, preserving the default global behavior. When the key is present,
only the listed files are included; paths may be relative to the workspace root
or to `build-context/`. An empty list explicitly disables fixed context for that
template. A single string is also accepted as shorthand for a one-item list.
Missing or invalid entries are reported but do not stop the build.

```yaml
build_context:
  - build-context/rules/citations.md
  - quality/gaps-and-review.md
```

## Layout

`templates/` and `build-context/` are both scanned recursively (`**/*.md`).

Templates live in one sub-directory per family, and `output` reproduces that
family so `deliverables/` mirrors `templates/`:

```text
templates/notes/basic-note.md        -> output: notes/basic-note.md
templates/briefs/project-brief.md    -> output: briefs/project-brief.md
```

`build-context/` is a single shared pool, organised by theme rather than by
family — these are the workspace's writing, citation and review rules:

```text
build-context/rules/*.md
build-context/quality/*.md
build-context/reference/*.md
```

Selection is the template's job, not the directory's: each template lists the
rules that apply to it. Nothing needs to be duplicated or moved per family.

Note that `wiki build` without arguments builds every template it finds, and
takes a workspace-wide lock while doing so. Adding a template adds to the cost
and to the lock footprint of every subsequent full build.

## Generating a template

The `new-template` skill drafts a template from what the wiki actually holds,
rather than from a blank page. It runs in agent mode and uses four tools:

| Tool                  | Role                                                        |
| --------------------- | ----------------------------------------------------------- |
| `wiki_outline`        | communities, their size and most connected pages — no content |
| `template_read`       | list templates, or read one with its build_context report    |
| `template_write`      | write a template, preview first                              |
| `build_context_write` | write a shared rule, preview first                           |

The flow is: frame (outline + targeted reads) → present a plan in chat →
approve → write. The skill never starts a build; run `wiki build` yourself
afterwards.

Both write tools return a diff preview unless `confirm=true`, and the template
preview resolves the `build_context` selection before anything is written —
so a dead reference or a selection past `maxBuildContextChars` shows up while
it is still cheap to fix. `build_context_write` additionally reports how many
templates would be rebuilt, since adding a shared rule invalidates every
template that inherits the global context.

Both refuse to write while a production job is running. This is not
politeness: the production agent derives a build's `deliverable:` lock from the
template's `output` frontmatter at the moment it takes the lock, so rewriting
that frontmatter mid-run leaves the job holding a lock on a file it is no
longer producing. Wait for the job, or cancel it.

Templates and `build-context/` are versioned by the workspace history, so a
generated template that is not yet committed will be picked up by the next
non-orchestrated command under `chore: manual changes before <command>`, and
`wiki restore` can revert it like any other tracked file.

## Importing sources

`llm-wiki` ingests standard markdown files from `raw/untracked/`. Put converted
source `.md` files there before running `wiki ingest`.

### Confluence through agent-cme

For Confluence, run the global [`agent-cme`](https://github.com/dotdrelle/agent-cme)
MCP server and register it in `llm-wiki-manager/mcp.endpoints.json`. The target
workspace is passed to `cme_export_run`, so exported Markdown lands directly in
that workspace's `raw/untracked/`:

```bash
WORKSPACES_ROOT=/path/to/workspaces \
  docker compose -f agent-external/agent-cme/docker-compose.yml up -d
./wiki-workspace wiki <workspace> ingest
```

CME credentials and source manifests live in the global agent data volume, while
exported Markdown lands in `<workspace>/raw/untracked/`. There is no separate
copy step for CME-sourced data.

### Markitdown

[markitdown](https://github.com/microsoft/markitdown) converts Office documents, PDFs, HTML, and other formats to markdown.

```bash
pip install 'markitdown[all]'
markitdown document.docx > raw/untracked/document.md
```
