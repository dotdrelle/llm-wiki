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

Each `[[INSTRUCTION: ...]]` slot is replaced at build time by a markdown fragment produced from wiki context. Multiple slots are processed in batches (`build.slotBatchSize` per LLM call).

## Prompt rules

The build prompt enforces these constraints:

- use only information present in the wiki context
- cite factual claims with `[src: wiki/sources/file.md]`
- if the wiki is missing evidence for a slot, say so explicitly
- do not fill gaps with speculation

## Build context

Fixed context files in `build-context/` are included verbatim in every build LLM call, up to `build.maxBuildContextChars`. Use them for style guides, formatting rules, or domain-level constraints that apply to all deliverables.

## Importing sources

`llm-wiki` ingests standard markdown files. Two tools make it easy to convert existing content.

### Confluence Markdown Exporter

[confluence-markdown-exporter](https://github.com/bdmac/confluence-markdown-exporter) exports a Confluence space as a tree of markdown files ready to drop into `raw/untracked/`.

```bash
python3 -m venv .cme
source .cme/bin/activate
pip install --upgrade pip
pip install confluence-markdown-exporter

cme config
cme space https://your-confluence.example/display/YOURSPACE/
```

The exported `.md` files can then be placed in `raw/untracked/` and ingested with `wiki ingest`.

### Markitdown

[markitdown](https://github.com/microsoft/markitdown) converts Office documents, PDFs, HTML, and other formats to markdown.

```bash
pip install 'markitdown[all]'
markitdown document.docx > raw/untracked/document.md
```
