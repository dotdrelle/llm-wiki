# Provenance — anchored sources, derived `sources:`, evidence manifest

This is the engine/deployer record for the provenance work implemented from
`plan-provenance-feuilles.md`. It is always on — the two-level citation shape,
the derived `sources:`, the deterministic loss guard and the evidence manifest
are the only writer, with no environment flag. The user-facing view is
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
  phantom and is dropped. A citation that names a SECTION follows only that
  section of the intermediate page — walking the whole page would attribute
  every other section's proofs to the caller and make the guard blind to a
  section-level change.
- **Anchoring is engine-side.** The model does not anchor reliably, so
  `provenance/anchor.ts` ties a bare citation — or re-ties a **fabricated**
  anchor — to the section whose significant tokens best match the claim
  (unique best, coverage floor). No confident match leaves it bare and reported.
- **A build freezes its evidence.** `build` writes
  `.wiki/builds/<buildId>/evidence.json` with the exact fragment text each
  citation resolved to; `export` prefers that frozen text, so replacing A-v1 by
  A-v2 after the build does not change the export. The id carries the deliverable
  path **and the content hash**, so a second build is a distinct manifest; the
  frozen map is keyed by `path#anchor`, so a section receives only the fragments
  it used. A fragment reached by SEVERAL chains keeps them all (`extraChains`),
  or the second leaf would vanish from the frozen map and its export would fall
  back to the live file. When a second build renders the SAME text but rests on
  different evidence, `writeEvidenceManifest` writes `<base>-<evidenceHash>`
  instead of overwriting the base. The evidence hash includes the fragment text
  and all citation chains, so a routing change also preserves the older manifest. `export --evidence-build
  <id>` selects a build explicitly (the ids are the directories under
  `.wiki/builds/`); without it the export reads `evidence_build_id` from the
  deliverable frontmatter. Build writes this field before publishing the file.
  Legacy deliverables without the field retain content-hash lookup. The current manifest format is schema v2: every hop in `chain`
  carries both `path` and `anchor` (`extraChains` is additive). A v1 manifest is
  refused and announced as missing evidence at export rather than silently
  widening a section-level citation.

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
| `src/provenance/retarget.ts` | two-level shape: leaf archive citation → source note |

Diagnostics: `pnpm audit:provenance <workspace>` and
`pnpm rebuild:provenance <workspace> [--apply] [--merge-splits]`. The audit
compares each page's declared `sources:` to its **terminal citation closure**, so
a two-level leaf (declaring the archive, citing the source note) is not reported
as a phantom.

## Always on

Anchored provenance is the only writer; there is no switch. On every ingest,
build and export the engine:
- renders the locator catalogue in the consolidation prompt and materializes
  the tokens;
- derives `sources:` at write time (`applyWikiOperationsAtomic`);
- supplies the §3.4 update context (full existing body + the excerpts of the
  sources a page already cites);
- anchors citations engine-side and validates the source page / anchored
  citations;
- applies the deterministic loss guard (below);
- writes the build evidence manifest and makes `export` consume it.

The reference corpus was migrated by validating on a COPY first (the plan's
rule) rather than by flipping a default later — the writer was already correct,
so the flag no longer bought anything.

The MCP tool `wiki_list_provenance_locators` (read-only, `wiki/sources/` +
`raw/ingested/`, no offsets/hashes) is what a curation run cites from; it is on
the manager's wiki read-only allow-list, and the gateway Redactor is told to copy
a token rather than invent an address.

## The two-level shape

The target is `livrable → section d'une feuille → section d'une page source →
fragment brut`. The prompt asks a concept leaf to cite the source note (never
`raw/ingested/…` directly); because the model does not always comply,
`provenance/retarget.ts` moves the leaf's section-precise archive citations onto
the source note, but only when the note's same-named section PROVES the very
fragment the leaf cited (same archive, same section, or the whole file). A
same-named heading that cites another fragment is not equivalent and is refused.
A citation the previous page already carried is left verbatim: the mere
existence of a source note must not rewrite a legacy `concept → raw` citation.
A citation without a resolvable anchor keeps its archive form — an honest
archive path beats a source-note path whose proof is not the one claimed.

## The multi-source guard

A leaf is the THEME: an update keeps what the page already states and adds the
new source. The model does not always do so, so the engine checks it
deterministically (`provenance/derive.ts`'s `detectSourceLoss`): the terminal
fragments reachable from the previous body's citation closure must all remain
reachable from the candidate's. A lost fragment refuses that operation — the
previous page is kept, the degradation is logged (`ingest:provenance-loss`) and
the rest of the ingest proceeds. A candidate that cites a whole file still
covers an earlier section of it; the loss is only ever a precise section whose
file remains cited by other sections.

An unresolvable citation refuses its operation too: a `missing` or `ambiguous`
anchor, an unusable source-page declaration, or an operation citing a page so
refused, is dropped (logged `ingest:provenance-refused`) while the source note
and the rest of the plan land. A bare, readable citation is allowed through —
it is the legacy whole-file form, anchored engine-side when the claim matches a
section.

These are refusals, not repairs: the model must re-compose the page. The prefix
merge (`--merge-splits`) repairs split duplicates; the loss guard stops a
composition from silently dropping a proof.

## Migration & rollback

A corpus can be re-normalized deterministically, without an LLM:

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

## Not shipped yet

- `evidence_revision` from git objects (retention / long-term rebuild) — the
  per-build manifest is the shipped mechanism.
- The Red Team / curation collective remains read-only on the workspace; it
  proposes a worktree branch a human merges, never a direct write.
