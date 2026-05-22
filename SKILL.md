---
name: llm-wiki-workspace-operator
description: Operate a local llm-wiki workspace. Use when the user wants to initialize a workspace, ingest Markdown sources, index/query the wiki, build deliverables from templates, export polished documents, or debug wiki configuration.
---

# llm-wiki Workspace Operator

`llm-wiki` is a local-first CLI. It turns Markdown sources in `raw/untracked/`
into a structured wiki, then regenerates deliverables from templates and cited
source context.

## Workspace Model

```text
raw/untracked/  -> wiki ingest -> wiki/ + raw/ingested/
wiki/           -> wiki index/query/build
templates/      -> wiki build -> deliverables/
deliverables/   -> wiki export <file> --polish -> *.export.polished.md
```

Important directories:

- `raw/untracked/`: incoming Markdown sources to ingest.
- `raw/ingested/`: processed source archive and ingestion skip baseline.
- `wiki/`: persistent, source-grounded Markdown knowledge base.
- `templates/`: Markdown templates with `[[INSTRUCTION: ...]]` slots.
- `build-context/`: fixed context injected into every build call.
- `deliverables/`: generated and exported documents.
- `.wiki/`: logs, build state, vector index, and runtime metadata.

## Preconditions

Confirm the current directory is the workspace root before running CLI commands:

```bash
test -f .wikirc.yaml
test -d raw
test -d wiki
```

If the workspace does not exist:

```bash
wiki init
```

Provider keys and model settings live in `.wikirc.yaml` or environment-specific
config. Do not put real API keys in examples, docs, commits, or generated
answers.

## Source Ingestion

Put Markdown sources under `raw/untracked/`, then run:

```bash
wiki doctor
wiki ingest
```

Useful variants:

```bash
wiki ingest --dry-run
wiki ingest --verbose
wiki ingest --debug
wiki ingest --trace-file .wiki/logs/ingest-manual.log
```

Rules:

- Do not delete `raw/ingested/` to force re-ingestion; it is the processed-source
  baseline.
- Use `--force` only when the user explicitly wants sources reprocessed.
- Ingested wiki content must preserve source citations and must not invent
  missing facts.
- If ingestion succeeds but refresh/build fails, keep the wiki changes and rerun
  `wiki refresh` or `wiki build` after fixing config.

## Retrieval And Query

When vector retrieval is enabled or changed, refresh the local LanceDB index:

```bash
wiki index
```

Ask source-grounded questions:

```bash
wiki query "What facts are documented about this topic?"
wiki query --save "What decisions are documented for this feature?"
```

Saved answers go under `wiki/answers/` and can be overwritten by the same saved
question.

## Build Deliverables

Plan before expensive generation:

```bash
wiki build --plan
```

Build all templates or a targeted template:

```bash
wiki build
wiki build templates/<template>.md
```

Template rules:

- Use `[[INSTRUCTION: ...]]` slots for generated sections.
- Factual claims must cite wiki/source context with `[src: ...]`.
- If evidence is missing, the output should say so instead of filling gaps.
- Use `build-context/` for stable style guides, standards, and reusable
  constraints that apply to every build.

## Export And Polish

Export a generated deliverable explicitly:

```bash
wiki export deliverables/<file>.md --polish
```

This produces an expanded `.export.md` and, with `--polish`, a
`.export.polished.md`. The polish pass may improve readability, but must
preserve facts, headings, structure, and source-grounding.

Do not run `wiki export` without a deliverable path.

## Verification

Run static checks:

```bash
wiki lint
```

Use LLM-backed checks only when the model/provider is configured and the extra
cost is acceptable:

```bash
wiki lint --with-llm
```

Before finishing substantial workspace changes, check:

- `raw/untracked/` is empty or only contains intentionally pending sources.
- `raw/ingested/` contains processed sources.
- `deliverables/` contains the expected generated/exported files.
- `wiki lint` has no unexpected findings.
- No secrets, absolute local paths, or generated workspace state are committed.

## Docker And Manager Mode

For standalone Docker:

```bash
docker compose up serve
docker compose --profile cli run --rm wiki doctor
docker compose --profile cli run --rm wiki ingest
```

When the workspace is managed by `llm-wiki-manager`, run commands from the
manager repository:

```bash
./wiki-workspace wiki <workspace> doctor
./wiki-workspace wiki <workspace> ingest
./wiki-workspace wiki <workspace> build --plan
./wiki-workspace wiki <workspace> build
./wiki-workspace wiki <workspace> export <deliverable> --polish
```
