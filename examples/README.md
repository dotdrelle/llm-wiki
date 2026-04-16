# Examples

The `examples/` directory contains sample inputs for a demo workspace:

- `raw/ai-adoption-notes.md`: a markdown source that can be dropped into `raw/untracked/`
- `templates/decision-note.md`: a derived document template with `[[INSTRUCTION: ...]]` slots

Typical flow:

```bash
wiki init
cp examples/raw/ai-adoption-notes.md raw/untracked/2026/04/16-ai-adoption-notes.md
cp examples/templates/decision-note.md templates/decision-note.md
wiki ingest
wiki build
```
