# Templates and deliverables

## Template format

Templates are standard markdown files with optional YAML frontmatter.

Recognized frontmatter keys:

| Key           | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `title`       | Kept in the generated markdown frontmatter                      |
| `output`      | Output path relative to `deliverables/`                         |
| `description` | Template-only metadata, stripped from output                    |

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

Fixed context files in `build-context/` are included verbatim in every build LLM call, up to `build.maxBuildContextChars`. Use them for style guides, formatting rules, or domain-level constraints that apply to all deliverables.

## Importing sources

`llm-wiki` ingests standard markdown files. Keep source conversion outside the workspace, then copy the resulting `.md` files into `raw/untracked/`.

### Confluence through agent-cme

For Confluence, use [`agent-cme`](https://github.com/dotdrelle/agent-cme) to export Markdown and [`llm-wiki-manager`](https://github.com/dotdrelle/llm-wiki-manager) to copy selected exports into the target workspace:

```bash
cd ../llm-wiki-manager
./wiki-workspace cme up
./wiki-workspace wiki <workspace> copy
./wiki-workspace wiki <workspace> ingest
```

`agent-cme` owns Confluence credentials and writes exports under `../agent-cme/data/exports/`. `llm-wiki-manager` copies only the export directories listed in each workspace env file.

### Markitdown

[markitdown](https://github.com/microsoft/markitdown) converts Office documents, PDFs, HTML, and other formats to markdown.

```bash
pip install 'markitdown[all]'
markitdown document.docx > raw/untracked/document.md
```
