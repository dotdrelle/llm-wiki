# Content lifecycle

This chapter describes the full journey of a piece of information: from the
source document to the finished deliverable. This is the core of what the
application does.

## 1. Inputs: sources

A **source** is an input document. Three origins:

- **Confluence**: a whole space or specific pages, via the dedicated connector.
- **Uploaded files**: your local documents (see `/upload`).
- **Converted documents**: any non-Markdown format goes through conversion
  first.

## 2. Conversion

The wiki works in Markdown. Non-Markdown formats (PDF, office…) are therefore
**converted** beforehand by the documents agent (text extraction, OCR if needed).
The resulting Markdown lands in a working area (`raw/untracked/`) where it forms
**reviewable raw material** before any integration.

## 3. Ingestion

**Ingestion** reads the sources and runs the TAXO cycle: meaningful sections
become evidence-bearing fiches, tags are assigned, and tag/family pivots are
regenerated. A section that cannot be processed is preserved or reported as a
degradation. There is no separate user-facing analysis then write step.


Some short sections may be **skipped**; failures and omissions are reported in
the run activity. Each ingestion updates the **index**
(the map of pages) and the **log** (the journal of operations).

## 4. The wiki

The wiki is the set of durable knowledge pages. It is organized into:

- **concepts**: reusable knowledge organized around the groupings found in the
  workspace's source material;
- **fiches** (`wiki/sources/`): concise section sheets nested below the
  document path, each with its own tags and citation to the archive;
- **tag/family pages** (`wiki/concepts/`): generated navigation pivots linking
  related fiches; they are not proof and are excluded from final build context;
- **archived documents** (`raw/ingested/`): the original documents, preserved
  as the complete evidence behind those notes;
- **index**: the canonical map that links and references the pages;
- **log**: the chronological journal of ingestions and updates.

Pages are linked to one another by internal links, so you can navigate from one
concept to the next.

The generated index separates **Project knowledge**, **Reading notes**, and
**Archived documents**. Reading notes summarize individual documents; archived
documents are the complete original evidence. The archive list links directly
to each ingested original, and search can return both a note and its original.

The overview section near the top of `wiki/index.md` is yours to review and
write. Edit between its overview markers; the engine preserves that text while
rebuilding the generated lists of project knowledge, reading notes, and
archived documents below it. A
generated draft includes exact evidence quotes that are checked again when you
apply it.
If an older index has no markers, regeneration keeps the file intact. To adopt
the canonical index, run `wiki index --overview`, review or edit
`.wiki/workspace-overview.draft.md`, then run `wiki index --apply-overview`.
The old index is preserved at `.wiki/index-legacy.md` before the overview and
generated lists are written. If that backup already contains different
content, adoption stops without changing `wiki/index.md`.
The engine checks that the draft citations still point to workspace pages and
that its evidence quotes still match their source text before replacing the
marked overview.

Every page also carries **OKF frontmatter**: its `type`, who generated it and
when (`generated`), its lifecycle status (`status`: draft / stable) and the raw
sources it was filed from (`sources`, with how many pages each source produced).
A page merged from a curation proposal is recorded as **verified and stable**.
`wiki doctor` reports the pages missing these keys and `--apply` writes them —
idempotently, never overwriting a value you wrote by hand.

## 4 bis. Sources and provenance

Each page keeps its own **source list** in the `sources` frontmatter. That list
is **computed from the page's own text**: only the sources an assertion actually
points to appear, so the list never drifts from what the page says, and a source
nothing is drawn from is not claimed.

A fiche cites the archived original directly. A tag page may point to several
fiches, but the fiche remains the evidence-bearing page. A citation names the
precise part it comes from:

    [src: wiki/sources/my-document.md#Costs > Licence]

The part after `#` is a section of the cited page. The engine anchors a bare
citation to the section that actually backs the claim, checks that the section
exists, and reports any citation it cannot resolve instead of showing a vague
one; a page whose citations cannot be resolved is not published.

A concept page is the **theme** of its subject across every source: an update
keeps what the page already said and adds the new source. The engine verifies
this deterministically — if an update would silently drop a fact a previous
source backed, that page update is refused and reported, and the rest of the
ingestion continues.

The fiche is a faithful reading sheet, not a complete copy. Search includes
archived documents so details omitted from it can still be found.

When a deliverable is built, the engine freezes the exact snippets it used. If
you later replace a source with a newer version, exporting the already-built
deliverable still uses the version it was built from — the document does not
change under you. The **Provenance** link of a deliverable page draws that
frozen chain in the graph, from each section down to the exact passages, and
flags the passages whose original has changed since.

## 5. Search

Wiki pages and archived originals are indexed for **semantic search**: you can
find information by its meaning, not just by keyword. Search results distinguish
the reading note from its original document, even when they share a title.
DONNA relies on these results to answer your questions about the workspace. The
knowledge **graph** is queryable too: how
pages cite their sources, which pages share a subject or a tag, and what path
links two documents — DONNA uses it to explain relationships without reading
every page.

## 6. Producing deliverables

From **templates**, DONNA regenerates **deliverables** — finished documents — by
filling them with the wiki's knowledge:

- **build**: (re)generates the deliverables;
- **export**: produces outputs to the outside (final files, exporting a
  Confluence space to Markdown…);
- **polish**: improves the form of existing content;
- **doctor**: diagnoses the state of the workspace and flags problems.

Every export and polish keeps a **versioned copy** of its result next to the
deliverable, named `<name>_v-YY.export.md` or `<name>_v-YY.export.polished.md`
(YY is a two-digit counter): the main file stays the one everything else
references, while each run's output is preserved and listed in the
Deliverables tab with its icon.

These operations can be chained; DONNA can also run a *pipeline* that combines
them with the knowledge steps below.

## 5 bis. Organizing the knowledge

The knowledge is organized as it is ingested — there is no separate grouping
step. Every source section becomes a **fiche** under
`wiki/sources/<document>/<section>.md`. Tags produce generated pivot pages under
`wiki/concepts/<family>/<tag>.md`; these pages organize navigation but do not
replace the fiches as evidence.

Filing a page by hand works too: move a page into a concept folder and it is
re-filed for real — its axes are rewritten and every link pointing at it is
repointed. A move keeps the page's own file name rather than renaming it
silently; the one exception is a file name already taken in the destination
folder: the moved page then lands under its **subject** (`<subject>.md`) —
its identity rather than its label — and only if that identity is filed there
too is the move refused.

A sync (Confluence) never overwrites local work: a pending file you deleted
stays deleted, and one you modified is flagged **orange** in the Pending panel
— keep it or delete it, the sync will not decide for you. To rebuild TAXO
fiches from the archived sources without touching Confluence, run
`wiki ingest --from-ingested` (see `07-commands-shell.md`). Ingestion always
runs the TAXO pipeline; there is no separate analysis/apply mode. A rebuild
removes obsolete generated tag pivots only when they are not stable or verified;
hand-written and protected pages are never touched.

For a workspace that still has the former flat source notes or generated
concept leaves, migration is explicit. On a **copy** of the workspace, first
run `wiki ingest --from-ingested --migrate-sheets` to list legacy pages that
would be removed and protected pages that would stay. After reviewing the
list, run `wiki ingest --from-ingested --migrate-sheets --apply` on that copy.
The command rebuilds from the complete archive first and removes legacy pages
only if every archived source succeeds; `stable` and `verified` pages are kept.

The full default chain is therefore: ingest, build, export, polish.

## 7. Tracking

While a job runs, follow it in the **Activity** panel (imports, ingestions,
exports, jobs) while DONNA explains the next step. At any time, `/status` sums up
the whole workspace.

## An end-to-end example

1. You connect a Confluence space as a source.
2. DONNA exports it to Markdown into the working area.
3. You run TAXO ingestion; fiches, tags, pivots and the index are regenerated.
4. The wiki fills up: section fiches, tag links and archived evidence.
5. You request a build: the deliverables come out, consistent with the wiki.
6. A new version of a document? You re-ingest: nothing is duplicated, only what
   is needed is updated.

To learn *how* to trigger all this, see `04-interaction-modes.md` (chat vs agent)
and `05-getting-started.md` (step by step).
