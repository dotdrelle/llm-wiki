import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import type { ExtractionKind, ExtractionScope } from './extractionSchema.ts';

/*
 Canonical provenance of a page: subject, scope, kind and tags.

 Filing labels live in the page path; opaque `concept_id` and `subject_id`
 values carry concept and subject identity independently of those labels.
 `subject`, `scope`, and `kind` are descriptive metadata, never identity keys.
 `tags` are free-vocabulary links between pages.
*/

export type PageProvenance = {
  subject: string | null;
  /** Stable, opaque identities; labels and paths may change or be translated. */
  concept_id?: string | null;
  subject_id?: string | null;
  scope: ExtractionScope | null;
  kind: ExtractionKind | null;
  /** Multivalued links: entity tags and theme tags, normalized + deduplicated. */
  tags: string[];
};

export function newKnowledgeIdentity(): string {
  return randomUUID();
}

export function isKnowledgeIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Canonical form of a provenance value.
 *
 * Unicode-normalized, lowercased, separators unified: canonically equivalent
 * spellings must designate the same subject without stripping marks that are
 * meaningful in many writing systems.
 */
export function normalizeProvenanceValue(value: string): string {
  const normalized = value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return [...normalized].slice(0, 64).join('').replace(/-+$/g, '');
}

export function isValidProvenanceValue(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(value)
    && [...value].length <= 64;
}

/**
 * Normalizes a list of tags: each is canonicalized, dropped when empty or
 * invalid, and duplicates (by normalized form) are removed in order.
 *
 * Tags are normalized labels. The engine does not apply language-specific
 * stemming or singularization; display vocabulary remains corpus-owned.
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

/** The canonical form of a tag value; preserve the complete normalized label. */
export function normalizeTagValue(value: string): string {
  return normalizeProvenanceValue(value);
}

function significantTokens(value: string): string[] {
  return value
    .split(/[-_]/)
    .filter((token) => [...token].length >= 3 && !/^\d+$/.test(token));
}

/**
 * Whether two normalized subjects name the same ENTITY: their leading tokens
 * match, or one subject is a prefix run of the other.
 *
 * This legacy predicate is only a candidate hint. Stable subject identity is
 * carried by subject_id; normalized labels are not authoritative keys.
 */
export function subjectsShareEntityRoot(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const rootA = a.split('-', 1)[0] ?? '';
  const rootB = b.split('-', 1)[0] ?? '';
  return [...rootA].length > 2 && rootA === rootB;
}

/**
 * How strongly two normalized subjects plausibly identify the same real-world
 * thing: 0 = unrelated, higher = better evidence.
 *
 * This is the LENIENT predicate, and the score exists because its consumer
 * keeps only the best few matches. `subjectMatchInventory` shows the model at
 * most five same-subject candidates; taken in corpus order, five pages sharing
 * nothing but "etude" crowded out the one genuine match and reopened the
 * concept-homonym defect (B17) this inventory exists to close.
 */
export function subjectMatchStrength(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (subjectsShareEntityRoot(a, b)) return 50;
  const tokensA = significantTokens(a);
  const tokensB = new Set(significantTokens(b));
  const shared = tokensA.filter((token) => tokensB.has(token));
  if (shared.length === 0) return 0;
  // Sharing several tokens beats sharing one, and a longer token is the more
  // specific of two — length stands in for rarity, which would need a corpus.
  return shared.length * 10 + Math.max(...shared.map((token) => Math.min(token.length, 9)));
}

/**
 * Whether two normalized subjects plausibly identify the same real-world
 * thing according to normalized label overlap. This is only for candidate
 * display; it never establishes identity or authorizes a merge.
 *
 * This is deliberately lenient: it only decides whether an existing page is
 * worth SHOWING the model as a reuse candidate during consolidation, never
 * whether to merge anything outright, so a false positive costs one inventory
 * line (ranked by `subjectMatchStrength`, so it is the first to be dropped)
 * while a false negative reproduces the concept-homonym defect it exists to
 * catch. Anything that DECIDES rather than shows must use
 * `subjectsShareEntityRoot` instead.
 */
export function subjectsAreRelated(a: string, b: string): boolean {
  return subjectMatchStrength(a, b) > 0;
}

export function isExtractionScope(value: unknown): value is ExtractionScope {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isExtractionKind(value: unknown): value is ExtractionKind {
  return typeof value === 'string' && value.trim().length > 0;
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

  // OKF v0.2 lifecycle, additive like everything else here: an ingested page
  // is a draft produced by the engine; a human merge later writes `verified`
  // and `status: stable` (see the agent-proposals review surface). A key set
  // by hand always wins.
  if (data.generated == null) {
    data.generated = { by: 'llm-wiki', at: new Date().toISOString() };
  }
  if (data.status == null) data.status = 'draft';

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
    concept_id: isKnowledgeIdentity(data.concept_id) ? data.concept_id : null,
    subject_id: isKnowledgeIdentity(data.subject_id) ? data.subject_id : null,
    scope: isExtractionScope(data.scope) ? data.scope : null,
    kind: isExtractionKind(data.kind) ? data.kind : null,
    tags: normalizeTags(data.tags),
  };
}
