import matter from 'gray-matter';
import {
  EXTRACTION_KINDS,
  EXTRACTION_SCOPES,
  type ExtractionKind,
  type ExtractionScope,
} from './extractionSchema.ts';

/*
 Canonical provenance of a page: subject, collection, scope, kind.

 Classification used to rely on `group:`, a free-form string written by the
 model. On a comparative corpus, this produced the opposite of what we want:
 five different products gathered under `security`, and the pages of a single
 product scattered between `software`, `feature` and `integration`. Provenance
 cannot be inferred from a label whose vocabulary nobody controls.

 These fields are therefore structured, normalized and validated. They do
 not replace `group:` — which remains a free classification signal — they
 remove from it the burden of proving an identity.

 No list of products, providers or domains is hardcoded here: normalization
 only canonicalizes the form of what the source said.
 */

export type PageProvenance = {
  subject: string | null;
  collection: string | null;
  scope: ExtractionScope | null;
  kind: ExtractionKind | null;
  /*
   The ranking class this page belongs to, taken from the workspace grid.

   `kind` and `class` answer two different questions and neither stands in for
   the other. `kind` says what a named thing IS — a product, a supplier, a
   regulation. `class` says where a DOCUMENT is filed, and one named thing is
   filed differently depending on what the page says about it. Deriving one from the other is what produced a corpus of
   entity pages: `kind` cannot name a class it was never given the vocabulary
   for.
  */
  class: string | null;
  /** Other classes the page also speaks to; the primary one stays `class`. */
  classSecondary: string[];
};

/**
 * Canonical form of a provenance value.
 *
 * Lowercased, accents removed, separators unified: `Name`, `name` and
 * `Name ` must designate the same subject, otherwise the identity we have
 * just introduced would suffer exactly the same flaw as `group:`.
 */
export function normalizeProvenanceValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isValidProvenanceValue(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

/**
 * Whether two normalized subjects plausibly identify the same real-world
 * thing, judging only by their leading token ("x" / "x-solution" /
 * "x-certifications" all share "x"). This is deliberately lenient:
 * it only decides whether an existing page is worth SHOWING the model as a
 * reuse candidate during consolidation, never whether to merge anything
 * outright, so a false positive costs one ignored inventory line while a
 * false negative reproduces the concept-homonym defect it exists to catch —
 * one page per source for what is really one subject.
 */
export function subjectsAreRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const rootA = a.split('-', 1)[0];
  const rootB = b.split('-', 1)[0];
  return rootA.length > 2 && rootA === rootB;
}

export function isExtractionScope(value: unknown): value is ExtractionScope {
  return typeof value === 'string' && (EXTRACTION_SCOPES as readonly string[]).includes(value);
}

export function isExtractionKind(value: unknown): value is ExtractionKind {
  return typeof value === 'string' && (EXTRACTION_KINDS as readonly string[]).includes(value);
}

/**
 * Injects provenance into the frontmatter of a page content.
 *
 * The injection is done by the ENGINE, not entrusted to the model. Asking an
 * LLM to write three exact fields in every page it produces is accepting that
 * they will be missing on one page in ten — and a provenance present nine times
 * out of ten is no better than an absent one: it makes the classification
 * inconsistent instead of making it incomplete.
 *
 * A value already present in the file and not provided here is kept: an
 * explicit manual edit takes precedence over the automatic projection.
 */
export function applyProvenance(content: string, provenance: PageProvenance): string {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };

  for (const [key, value] of Object.entries(provenance)) {
    if (value == null) continue;
    // An empty secondary list is not a value: writing `classSecondary: []` in
    // every frontmatter would say "no other class applies" where the truth is
    // "nobody looked".
    if (Array.isArray(value) && value.length === 0) continue;
    data[key] = value;
  }

  if (!Object.keys(data).length) return content;
  return matter.stringify(parsed.content, data);
}

/**
 * Reads the provenance of an existing page.
 *
 * A malformed value is treated as absent rather than repaired: repairing it
 * silently would let an identity that nobody validated enter the classification.
 */
export function readProvenance(content: string): PageProvenance {
  const { data } = matter(content);
  const read = (key: 'subject' | 'collection' | 'class'): string | null => {
    const value = data[key];
    return typeof value === 'string' && isValidProvenanceValue(value) ? value : null;
  };
  return {
    subject: read('subject'),
    collection: read('collection'),
    scope: isExtractionScope(data.scope) ? data.scope : null,
    kind: isExtractionKind(data.kind) ? data.kind : null,
    class: read('class'),
    classSecondary: Array.isArray(data.classSecondary)
      ? data.classSecondary.filter(
        (value): value is string => typeof value === 'string' && isValidProvenanceValue(value),
      )
      : [],
  };
}

/**
 * Provenance of a source, as the engine infers it without inventing anything.
 *
 * The collection comes from the STRUCTURE of the source — the directory that
 * gathers sibling documents — because it is the only signal available before
 * any model decision. The subject, on the other hand, is not inferred from the
 * path: a file name is an export accident, and promoting it to an identity
 * would reopen the door that `group:` left open. It is proposed by the
 * consolidation, which has read the document.
 */
export function collectionFromSourcePath(relativePath: string): string | null {
  const parts = relativePath.split('/').filter(Boolean);
  // The collection is the IMMEDIATE parent of the document, not the first
  // export root: taking the first segment after `untracked`/`ingested` would
  // group unrelated documents into a collection far too broad. The parent
  // folder that gathers sibling documents is the right granularity.
  const index = parts.findIndex((part) => part === 'untracked' || part === 'ingested');
  if (index < 0 || parts.length - index < 3) return null;
  const parentIndex = parts.length - 2;
  if (parentIndex <= index) return null;
  const folder = normalizeProvenanceValue(parts[parentIndex]!);
  return folder && isValidProvenanceValue(folder) ? folder : null;
}
