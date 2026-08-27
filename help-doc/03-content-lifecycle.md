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

**Ingestion** reads the sources and extracts wiki pages from them. This is the
step that turns disorder into a map. It happens in two stages:

- **Dry-run**: DONNA prepares a *plan* of what would be created or updated,
  without writing anything. You review it.
- **Apply**: after your confirmation, pages are actually created or updated.

Some pages may be **rejected** (content judged irrelevant or redundant): you can
discuss this with DONNA before applying. Each ingestion updates the **index**
(the map of pages) and the **log** (the journal of operations).

## 4. The wiki

The wiki is the set of durable knowledge pages. It is organized into:

- **concepts**: reusable knowledge (a system, an actor, a rule, an
  architecture);
- **sources**: source notes that trace where each piece of information comes
  from;
- **index**: the canonical map that links and references the pages;
- **log**: the chronological journal of ingestions and updates.

Pages are linked to one another by internal links, so you can navigate from one
concept to the next.

## 5. Search

The wiki content is indexed for **semantic search**: you can find information by
its meaning, not just by keyword. DONNA relies on this index to answer your
questions about your domain.

## 6. Producing deliverables

From **templates**, DONNA regenerates **deliverables** — finished documents — by
filling them with the wiki's knowledge:

- **build**: (re)generates the deliverables;
- **export**: produces outputs to the outside (final files, exporting a
  Confluence space to Markdown…);
- **polish**: improves the form of existing content;
- **doctor**: diagnoses the state of the workspace and flags problems.

These operations can be chained; DONNA can also run a *pipeline* that combines
them with the knowledge steps below.

## 5 bis. Organizing the knowledge

Between ingestion and production, three steps keep the wiki navigable. They run
in this order, and each one assumes the previous is done:

- **concepts**: synthesizes the **concept grid** — the small, closed set of
  headings the wiki is filed under;
- **reclassify-concepts**: files the pages sitting in
  `wiki/concepts/unclassified` into that grid, without rebuilding it;
- **taxonomy**: republishes the **graph taxonomy** used by the `/graph` view and
  by navigation.

Filing a page by hand works too: drag a page out of
`wiki/concepts/unclassified/` into a class folder and it is re-filed for real —
its `class` is rewritten and every link pointing at it is repointed. A class the
grid does not declare is refused rather than half-applied, and a whole class
folder cannot be dragged: emptying or retiring a class changes the vocabulary,
not just the files.

An ingestion already ends with the three of them, so you rarely run them by
hand. When you do — after editing pages directly, or when a grid rebuild left
strays behind — pick the narrowest one that covers your case; see the skills in
`08-commands-serve.md`.

The full default chain is therefore: ingest, concepts, reclassify-concepts,
taxonomy, build, export, polish.

## 7. Tracking

While a job runs, follow it in the **Activity** panel (imports, ingestions,
exports, jobs) while DONNA explains the next step. At any time, `/status` sums up
the whole workspace.

## An end-to-end example

1. You connect a Confluence space as a source.
2. DONNA exports it to Markdown into the working area.
3. You run a dry-run ingestion, review the proposed pages, then apply.
4. The wiki fills up: pages, concept grid, links, index, taxonomy.
5. You request a build: the deliverables come out, consistent with the wiki.
6. A new version of a document? You re-ingest: nothing is duplicated, only what
   is needed is updated.

To learn *how* to trigger all this, see `04-interaction-modes.md` (chat vs agent)
and `05-getting-started.md` (step by step).
