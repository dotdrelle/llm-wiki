# Workspace Notes

This workspace follows a local-first LLM Wiki pattern.

- Put new markdown sources in `raw/untracked/`.
- `wiki/` contains the persistent knowledge base maintained by the CLI.
- `templates/` contains markdown deliverable templates with `[[INSTRUCTION: ...]]` placeholders.
- `deliverables/` contains generated markdown outputs and should stay reproducible.
- Generated content must never invent facts that are not documented in the wiki.
