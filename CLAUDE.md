# Repository Guide

## Goal

`llm-wiki` is a local-first Node.js 22 CLI that maintains a persistent markdown wiki from source documents, then regenerates derived markdown deliverables from templates.

## Architecture

- `bin/wiki.ts`: Commander entrypoint.
- `src/config`: config loading and zod validation for `.wikirc.yaml`.
- `src/services`: orchestration for workspace IO, retrieval, ingest, query, build, refresh, and lint.
- `src/prompts`: prompt builders for LLM interactions.
- `src/utils`: path safety, hashing, JSON extraction, markdown helpers.
- `scaffold/workspace`: files copied by `wiki init`.
- `examples`: runnable sample inputs.
- `tests`: Vitest coverage for config, template parsing, build flow, and path safety.

## Constraints

- Local-first only. No vector database.
- Deliverables must remain regenerable and stable in Git.
- Never write outside the workspace root.
- Generated deliverables must not invent missing information.
