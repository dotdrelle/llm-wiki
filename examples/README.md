# Examples

The `examples/` directory contains sample inputs for a demo workspace.

These examples are for the `llm-wiki` CLI itself. If you run multiple workspaces through `llm-wiki-manager`, copy these files into the target workspace path and run commands through `./wiki-workspace wiki <workspace> ...`.

## Files

- `raw/ai-adoption-notes.md` — a markdown source to drop into `raw/untracked/`
- `templates/decision-note.md` — a simple template with `[[INSTRUCTION: ...]]` slots
- `templates/project-brief.md` — a richer template that relies on `build-context/`
- `build-context/writing-standards.md` — fixed writing standards injected into every build prompt

## Basic flow (templates + wiki)

```bash
wiki init
cp examples/raw/ai-adoption-notes.md raw/untracked/
cp examples/templates/decision-note.md templates/decision-note.md
wiki ingest
wiki build
```

`wiki build` retrieves relevant wiki chunks for each `[[INSTRUCTION: ...]]` slot, plans batches against the configured prompt limits, and fills them using the configured LLM. The result is written to `deliverables/decision-note.md`.

## Flow with build-context

`build-context/` holds files that are included verbatim in every build prompt, regardless of retrieval. Use it for constraints that apply to all deliverables: writing standards, output format rules, a project glossary, or a target audience definition.

```bash
wiki init
cp examples/raw/ai-adoption-notes.md raw/untracked/
cp examples/templates/project-brief.md templates/project-brief.md
cp examples/build-context/writing-standards.md build-context/writing-standards.md
wiki ingest
wiki build
```

Each `[[INSTRUCTION: ...]]` slot in `project-brief.md` is filled with:

- retrieved wiki chunks from `wiki/` (vector search when available, lexical fallback otherwise)
- the full content of `build-context/writing-standards.md` (always present)

The result is written to `deliverables/briefs/project-brief.md`.

### When to use build-context vs wiki

| | `wiki/` | `build-context/` |
|---|---|---|
| Content type | project knowledge, facts, decisions | fixed constraints, standards, rules |
| Injected how | retrieved by keyword match per slot | included in full for every build call |
| Updated by | `wiki ingest` | manually |
| Cited in output | yes, with `[src: ...]` | governs style, not cited |
