import matter from 'gray-matter';
import {
  EXTRACTION_KINDS,
  EXTRACTION_SCOPES,
  type ExtractionKind,
  type ExtractionScope,
} from './extractionSchema.ts';

/*
 Canonical provenance of a page: subject, scope, kind and tags.

 Classification used to rely on `class:` — a filing class written in the
 frontmatter and checked against a closed grid — and on `group:`, a free-form
 string. Both were copies of a decision the file's own PATH already carries:
 the concept folder a leaf lives in (`wiki/concepts/<concept>/<subject>.md`).

 The folder is the concept. `subject` is the canonical identity (normalized,
 controlled — the join key for the entity node). `scope` and `kind` describe the
 NATURE of the subject — the signal the consolidation uses to decide
 granularity, never a taxonomy level. `tags` are the multivalued links.
*/

export type PageProvenance = {
  subject: string | null;
  scope: ExtractionScope | null;
  kind: ExtractionKind | null;
  /** Multivalued links: entity tags and theme tags, normalized + deduplicated. */
  tags: string[];
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
 * Normalizes a list of tags: each is canonicalized, dropped when empty or
 * invalid, and duplicates (by normalized form) are removed in order.
 *
 * A tag is a SINGLE word: the compound value is reduced to its first term
 * (`bande-passante` → `bande`). The singular is the model's job, asked in the
 * prompt — depluralizing here would mangle acronyms (`saas` → `saa`, `eas` →
 * `ea`), so the engine never drops a trailing letter.
 */
export function normalizeTags(values: unknown): string[] {
  const list = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizeTagValue(raw);
    if (!normalized || !isValidProvenanceValue(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * The canonical form of a tag value: normalized, then reduced to its first
 * term.
 */
export function normalizeTagValue(value: string): string {
  const normalized = normalizeProvenanceValue(value);
  if (!normalized) return '';
  return normalized.split(/[-_]/)[0] ?? '';
}

/**
 * Whether two normalized subjects plausibly identify the same real-world
 * thing, judging only by their leading token ("x" / "x-solution" /
 * "x-certifications" all share "x"). This is deliberately lenient:
 * it only decides whether an existing page is worth SHOWING the model as a
 * reuse candidate during consolidation, never whether to merge anything
 * outright, so a false positive costs one ignored inventory line while a
 * false negative reproduces the concept-homonym defect it exists to catch.
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
 * The injection is done by the ENGINE, not entrusted to the model. A value
 * already present in the file and not provided here is kept: an explicit
 * manual edit takes precedence over the automatic projection.
 *
 * `type` is the OKF type (see `okf/frontmatter.ts`), written ADDITIVELY.
 */
export function applyProvenance(content: string, provenance: PageProvenance, type?: string | null): string {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };

  for (const [key, value] of Object.entries(provenance)) {
    if (value == null) continue;
    // An empty tags list is not a value: writing `tags: []` in every frontmatter
    // would say "no link applies" where the truth is "nobody looked".
    if (Array.isArray(value) && value.length === 0) continue;
    data[key] = value;
  }

  if (type != null && data.type == null) data.type = type;

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
  const subject = data.subject;
  return {
    subject: typeof subject === 'string' && isValidProvenanceValue(subject) ? subject : null,
    scope: isExtractionScope(data.scope) ? data.scope : null,
    kind: isExtractionKind(data.kind) ? data.kind : null,
    tags: normalizeTags(data.tags),
  };
}
