# Provenance — anchored sources, derived `sources:`, evidence manifest

This is the engine/deployer record for the provenance work implemented from
`plan-provenance-feuilles.md` (lots 0–5). The user-facing view is
`help-doc/03-content-lifecycle.md`.

## The problem

A leaf could claim several sources in its frontmatter (`sources:` was unioned
blindly by `carryForwardEngineFrontmatter`) while its body cited only one, with
bare whole-file citations repeated after every `##`. So the declared provenance
did not match the text, and `export` had to re-read whole files.

## The model — three layers, one address

```
build / livrable
  → section of a concept leaf
    → section of one or more source pages
      → precise fragment of a raw/ingested document
```

1. **`raw/ingested/` is the original proof.** Its `#`/`##` are the anchors; a
   locator targets a section, materialized as `[src: <path>#<Heading > Sub>]` or
   `[src: <path>#L42-L57@sha256=<digest>]`.
2. **`wiki/sources/` is the harmonized reading sheet of ONE document**: a
   `## Résumé`, then `## <theme>` sections, each ending with an anchored
   citation. It stays weakly interpretive — it reports what the document says
   and nothing else (`validateSourcePage`).
3. **`wiki/concepts/<domain>/<subject>.md` is the theme**, composed across
   sources. A section ends with every source that backs it and no source it does
   not draw from.

The concept remains the folder; the path remains the leaf's identity. No new
`leafId`, no concept registry, no global taxonomy.

## Contracts

- **Citation is an address.** The model copies an opaque locator token
  (`section:…`, `fragment:…`) from a bounded catalogue; the engine materializes
  the terminal address. The model never writes an offset or a hash.
- **`sources:` is derived, not accumulated.** It is recomputed from the body's
  citation closure (`provenance/derive.ts`); a declared-but-unreached entry is a
  phantom and is dropped.
- **Anchoring is engine-side.** The model does not anchor reliably, so
  `provenance/anchor.ts` ties a bare citation — or re-ties a **fabricated**
  anchor — to the section whose significant tokens best match the claim
  (unique best, coverage floor). No confident match leaves it bare and reported.
- **A build freezes its evidence.** `build` writes
  `.wiki/builds/<buildId>/evidence.json` with the exact fragment text each
  citation resolved to; `export` prefers that frozen text, so replacing A-v1 by
  A-v2 after the build does not change the export.

## Modules

| Module | Role |
| --- | --- |
| `src/provenance/locators.ts` | heading codec, bounded catalogue, materialization, strict resolution |
| `src/provenance/anchor.ts` | engine-side anchoring (bare + fabricated citations) |
| `src/provenance/derive.ts` | terminal `sources:` closure + integrity check |
| `src/provenance/write.ts` | derive/rewrite the `sources:` inventory |
| `src/provenance/resolver.ts` | transitive resolution + evidence manifest (read/write) |
| `src/provenance/sourcePage.ts` | source-page template + contract validation |
| `src/provenance/validate.ts` | anchored-citation validation |
| `src/provenance/merge.ts` | deterministic prefix near-duplicate leaf merge |
| `src/provenance/audit.ts` | read-only corpus audit (lot 0) |
| `src/provenance/rebuild.ts` | no-LLM repair: anchoring + `sources:` + merge |
| `src/provenance/mode.ts` | the `WIKI_PROVENANCE_MODE` switch |

Diagnostics: `pnpm audit:provenance <workspace>` and
`pnpm rebuild:provenance <workspace> [--apply] [--merge-splits]`.

## Enabling it — opt-in

`WIKI_PROVENANCE_MODE=1` turns on:
- the locator catalogue in the consolidation prompt and token materialization;
- `sources:` derivation at write time (`applyWikiOperationsAtomic`);
- the §3.4 update context (full existing body + the excerpts of the sources a
  page already cites);
- engine-side anchoring and the source-page / anchored-citation validation;
- the build evidence manifest and its use by `export`.

Off by default: the active corpus is never migrated in silence.

The MCP tool `wiki_list_provenance_locators` (read-only, `wiki/sources/` +
`raw/ingested/`, no offsets/hashes) is what a curation run cites from; it is on
the manager's wiki read-only allow-list, and the gateway Redactor is told to copy
a token rather than invent an address.

## Migration & rollback (lot 6)

A corpus can be moved deterministically, without an LLM:

```bash
# on a COPY first
pnpm audit:provenance   /path/to/copy
pnpm rebuild:provenance /path/to/copy --apply --merge-splits
pnpm audit:provenance   /path/to/copy
```

`rebuild:provenance` re-anchors citations, derives `sources:` and (with
`--merge-splits`) merges prefix near-duplicate leaves. It never calls the model.

Rollback: the workspace is git (revert-forward); `git revert <ingest-commit>`
restores the previous pages. `.wiki/builds/` manifests are local, unversioned
state and can be removed to force a live resolution.

The default writer is **not** flipped: the deterministic layers are validated,
but multi-source composition is model-dependent and the two-level citation shape
(leaves citing `wiki/sources/` instead of `raw/`) is not produced by the ingest
pipeline yet. The feature stays opt-in and is announced as such.

## Not shipped yet

- Leaves citing `wiki/sources/…` (the two-level shape) — the model still cites
  `raw/ingested/…` directly.
- Deterministic multi-source composition: the model composes only sometimes
  (measured 8 then 2 multi-source over two identical runs); the prefix merge
  repairs split duplicates but finds none on the reference corpus.
- `evidence_revision` from git objects (retention / long-term rebuild) — the
  per-build manifest is the shipped mechanism.
