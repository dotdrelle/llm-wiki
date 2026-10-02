# Provenance — anchored sources, derived `sources:`, evidence manifest

This is the engine/deployer record for the provenance work implemented from
`plan-provenance-feuilles.md` (lots 0–5, released in 0.15.100–0.15.101; the
plan is archived outside this repo, at the wikiLLM root's `_tmp/done/`). It is
always on — the fiche/pivot citation shape,
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
  → optional tag/family pivot
    → TAXO fiche (source section)
      → precise fragment of a raw/ingested document
```

1. **`raw/ingested/` is the original proof.** Its `#`/`##` are the anchors; a
   locator targets a section, materialized as `[src: <path>#<Heading > Sub>]` or
   `[src: <path>#L42-L57@sha256=<digest>]`.
2. **`wiki/sources/` contains TAXO fiches**: one nested page per meaningful
   source section. Each fiche has a section subject, tags, a faithful body and
   an anchored citation to exactly one archive. `validateSourcePage` is shared
   by ingest and `wiki_write_page`; the old flat source-note page is retained
   no flat source-note page is generated.
3. **`wiki/concepts/<family>/<tag>.md` is a generated pivot**, not a proof. Its
   links are regenerated from fiches, its derived `sources:` inventory remains
   complete, and stable/verified pages are protected from automatic replacement.

Folders remain the current storage layout, while `concept_id` and `subject_id`
are opaque UUID identities stored in page frontmatter. Labels and paths are
mutable presentation/storage details; graph grouping and cross-folder subject
links prefer the stable IDs and fall back to legacy labels when IDs are absent.
Subject labels and tags are normalized with Unicode NFC and case folding while
preserving combining marks, so canonical spelling differences do not make
scripts with combining characters unreadable or collapse their labels.
New ingestion writes IDs lazily and carries them forward on updates. Existing
workspaces still need an explicit preview/apply backfill before labels or paths
can be migrated safely; that migration is part of the multi-workspace
knowledge-recentering work at the workspace root.

The first migration command is available as
`pnpm concepts:identities <workspace-copy>` (preview) and the same command with
`--apply`. It gives current folder groups and unambiguous subject groups stable
UUIDs without moving pages. A matching subject label inside one concept group
can share an ID; when that label appears under multiple concept identities,
the command leaves missing `subject_id` values unassigned and reports the pages
for review instead of assuming they are the same entity. Conflicting IDs are
also reported and left untouched, including a `concept_id` reused under
multiple folder labels. This is a safe identity backfill, not the semantic
concept cleanup; that still needs a reviewed map based on each workspace's
corpus. Its `concepts` inventory groups pages by current folder and reports
identity completeness, subjects, cited sources, and up to four short page
excerpts per folder. Subject and citation lists are capped at 24 per folder;
their total counts make the preview boundary visible. Use that corpus-derived map to review the current axes
before preparing a relabel mapping. UUID values in preview output are
provisional; `--apply` assigns opaque IDs to unambiguous display-label groups
without deriving them from those labels.

Reviewed concept-map changes use `pnpm concepts:relabel <workspace-copy>
<mapping.json>` (preview) and `--apply` after review. The JSON can rename a
concept folder by `concept_id`, or explicitly refile a page path under another
existing `concept_id`. It does not merge identities or infer semantic moves.
Flat legacy pages directly under `wiki/concepts/` are inventoried separately;
they remain untouched until an operator explicitly lists each page in a
`legacyGroups` entry. A group creates one fresh opaque concept identity and
moves only those listed pages into the named folder. Preview IDs are
provisional; inspect the paths and grouping, then apply. No model or built-in
vocabulary chooses the grouping or label.
The command checks that affected pages and target concepts have unique
identities, rejects path collisions, preserves `subject_id` and citations,
rewrites inbound wiki references, and regenerates `wiki/index.md`. Its report
marks the vector index stale so `wiki index` can rebuild it. A mapping has this
shape:

```json
{
  "schemaVersion": 1,
  "concepts": [
    { "concept_id": "<UUID from the workspace>", "label": "<new folder label>" }
  ],
  "pages": [
    { "path": "wiki/concepts/<current-label>/<page>.md", "concept_id": "<existing target UUID>" }
  ],
  "legacyGroups": [
    { "label": "<reviewed folder label>", "pages": ["wiki/concepts/<legacy-page>.md"] }
  ]
}
```

The `pages` array is optional. Each entry is an explicit reviewed decision;
preview reports the source and destination paths and both concept identities.
The target identity must already exist in one unambiguous folder. For a
taxonomic leaf, the engine updates its folder metadata and filename prefix;
ordinary leaves keep their filename. The original archive and source notes are
not rewritten. When `.wiki/source-registry.json` exists, its produced-page
references are updated under the registry lock as part of the migration, so a
later ingest can still re-anchor the source's pages. An invalid registry
refuses the migration rather than silently dropping ownership references.
`legacyGroups` is optional and each listed path must be a flat legacy page.
Each group label must be unique and must not collide with an existing folder.
The migration assigns the group's concept identity and derives each page's
`subject` from its new filename; existing `subject_id` values and citations are
preserved.

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
| `src/provenance/retarget.ts` | compatibility retargeting: legacy archive citation → source fiche |
| `src/graph/wiki/provenanceGraph.ts` | read-only provenance graph of one deliverable, for the graph's Provenance view |

The graph's Provenance view (`/graph?provenance=<deliverable>`, served by
`GET /api/graph/provenance?id=&build=&mode=`) is a **reader** of the manifest,
not a second resolver. It takes the build named by `evidence_build_id` (or
`build=`), turns each fragment's `chain`/`extraChains` into node paths, and
compares the frozen `hash` with the current archive (`unchanged` / `changed` /
`missing`). A manifest `chain` starts at the first wiki page cited, not at the
deliverable section: the section is recovered by matching each section's own
`[src:]` citations (`extractBodyCitations`) against the chain's first hop. An
export artifact resolves to its source deliverable (`utils/exportArtifact.ts`,
shared with the export refusal). `mode=live` re-runs `resolveEvidence` on the
current files; a missing or v1 manifest falls back to that live reading, and
every fallback, broken anchor or fragment no longer reached is returned in
`degradations` for the view to list.

Diagnostics: `pnpm audit:provenance <workspace>` and
`pnpm rebuild:provenance <workspace> [--apply] [--merge-splits]`. The audit
compares each page's declared `sources:` to its **terminal citation closure**, so
a TAXO pivot/fiche chain whose terminal proof is declared is not reported
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

## The fiche/pivot shape

The target is `livrable → optional tag/family pivot → TAXO fiche → fragment
brut`. TAXO writes one fiche per meaningful source section, preserving its
section body, tags and an engine-anchored citation to the raw archive. A
generated pivot links back to those fiches and is navigation, not proof. Old
source-note pages and concept leaves are not generated by the new workflow;
when a source is re-ingested, obsolete registry-owned draft pages are removed,
while stable/verified and unowned pages are left intact.

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
refused, is dropped (logged `ingest:provenance-refused`) while the valid fiches
and the rest of the ingestion land. A bare, readable citation is allowed through —
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
