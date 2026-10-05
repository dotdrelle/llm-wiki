# Maintenance facts and output protection (engine side)

The manager's automatic maintenance (`llm-wiki-manager/docs/agentic-runtime.md`
§ Automatic maintenance; user view `help-doc/14-maintenance.md`) decides and
dispatches. The engine only provides facts and protects what it writes. Code:
`src/maintenance/`.

## `wiki_maintenance_state` (MCP, read-only)

`maintenanceState(config, quietMinutes)` returns, without a model call:

- `pending` — every `raw/untracked/**/*.md` with its hash, `stable` (mtime older
  than `quietMinutes`) and `protected` (listed in `.wiki/cme-sync.json`
  `modifiedLocally`, or every file when that marker is unreadable — reason
  `sync_marker_invalid`). There is no watcher: the manager polls.
- `deliverables` — per template: `fresh`, `reasons` (`build_not_tracked`,
  `output_missing`, `template_changed`, `knowledge_changed`, `context_changed`,
  `output_modified`), a `version` and `artifacts.{export,polish}` (whether a
  publication already exists — maintenance never proposes a first one).
- `publications` — the receipts below, with `fresh` and a `reason`.
- `index` — `{enabled, fresh}` from `.wiki/vector-freshness.json`, written after
  each vector index build (hash of the indexed pages + embedding model).
- `proposals` — files in `.wiki/agent-proposals/`.

Decisions and budgets are NOT here; they live in the manager.

## Freshness inputs

- `computeWikiHash` excludes `wiki/index.md` and `wiki/log.md`
  (`FINAL_CONTEXT_EXCLUDED_PATHS`, one definition shared with the build
  context) and carries `BUILD_INPUT_SIGNATURE`. Every ingest rewrites those two
  pages; counting them made each ingest stale every deliverable. The same hash
  feeds `lint`'s stale-deliverable list, which therefore changes the same way.
  A record written before the signature carries the legacy fingerprint (every
  page, no signature): `knowledgeUnchanged` accepts it when it still matches the
  wiki as it is now (`computeLegacyWikiHash`), so an upgrade does not stale
  everything; the next build writes the new fingerprint.
- `outputHash` in `.wiki/build-state.json` is the hash of the bytes
  `writeDeliverable` writes (after `normalizeGeneratedMarkdown`), marked
  `outputHashVersion: 2`. Only such a record can report `output_modified`; a
  legacy record (hash of the un-normalized text) is never taken for a hand
  edit. A hand-edited output is not fresh, so `changedOnly` rebuilds it.

## Output guard (`outputGuard.ts`)

Every build and export write goes through `publishOutput`: under a per-output
lock it re-reads the file, refuses with `output_changed_during_generation` when
it differs from the snapshot taken before generation (the current bytes are
kept), refuses symlinks and paths outside the workspace, and writes a verified
backup to `.wiki/output-backups/<hash(path)>/<hash(content)>.md` first — the
last 5 per output are kept, independent of git. External editors that ignore
the lock get no compare-and-swap guarantee.

## Hand-added sections (`humanSections.ts`)

Each build records `producedSections` — the section keys (normalized heading
paths) of the template render, before any merge — in `.wiki/build-state.json`.
At the next build, with or without `stabilize`, a section of the existing file
absent from that list was written by hand: `preserveHumanSections` copies it
verbatim after the section that preceded it (after that section's own
sub-sections). A section that was produced and no longer is gets dropped. The
stabilize sidecar lists the carried sections under `preserved`, and the build
logs `build:human-sections-kept`. A record without `producedSections` (built
before this rule) preserves nothing; the maintenance state exposes it as
`handSectionsTracked: false`. A hand-renamed template heading reads as a hand
section, so the renamed copy is kept beside the regenerated original.

## Publication receipts (`publications.ts`)

`export`/`polish` write `.wiki/publications/<id>.json`: source path and hash,
`evidence_build_id`, operation, parameters, output path and hash, status
`prepared` → `verified` after a read-back. The most recent receipt per output is
authoritative; `fresh` means the output and the source still match their
hashes, and its `parameters.transform` still equals `transformSignature`
(`EXPORT_PROMPT_VERSION`, session language, operation — not the model, so a
profile switch does not stale every export). Bump `EXPORT_PROMPT_VERSION` when
an export/polish prompt change alters the output; a mismatch reads
`settings_changed`. A receipt without `transform` (older) is not flagged. A
`prepared` receipt whose output matches is reported `recovered` (crash between
write and verification).

## Maintenance ingest selection

A maintenance ingest carries the approved `{path, hash}` list
(`WIKI_MAINTENANCE_SELECTION`, set per job by the production agent). The ingest
re-validates each source before reading it and again just before its first
write: a changed, unstable or protected file fails that source instead of
ingesting bytes nobody approved.
