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
 * Tokens too generic to prove two subjects are the same thing. Sharing
 * "solution" or "system" says nothing; sharing "infra" or "jedox" does.
 */
const SUBJECT_STOPWORDS = new Set([
  'solution', 'solutions', 'systeme', 'systemes', 'system', 'systems',
  'service', 'services', 'produit', 'produits', 'product', 'products',
  'outil', 'outils', 'tool', 'tools', 'projet', 'projets', 'project', 'projects',
  'data', 'donnees', 'gestion', 'management', 'note', 'notes',
  'info', 'information', 'informations', 'general', 'generale', 'autre', 'autres',
  'model', 'modele', 'models', 'modeles', 'version', 'versions',
  'plan', 'plans', 'type', 'types', 'niveau', 'niveaux', 'phase', 'phases',
]);

function significantTokens(value: string): string[] {
  return value
    .split(/[-_]/)
    // A bare number is never evidence of identity. "budget-2024" and
    // "roadmap-2024" share nothing but a year, and years are exactly the kind
    // of token a folder-naming convention sprinkles over every subject.
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !SUBJECT_STOPWORDS.has(token));
}

/**
 * Whether two normalized subjects name the same ENTITY: their leading tokens
 * match, or one subject is a prefix run of the other.
 *
 * Subjects are written entity-name-first (`jedox-etude-onpremise`, never
 * `etude-jedox-…` — the `operationContract` enforces it), so the leading token
 * IS the entity. This is the STRICT predicate: it decides whether two leaves
 * in one concept folder are a duplicate of each other, which costs LLM retry
 * rounds and pressures the model into collapsing two genuinely different
 * things. `jedox-cloud` and `anaplan-cloud` are two products, not one.
 */
export function subjectsShareEntityRoot(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const rootA = a.split('-', 1)[0] ?? '';
  const rootB = b.split('-', 1)[0] ?? '';
  return rootA.length > 2 && rootA === rootB && !SUBJECT_STOPWORDS.has(rootA);
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
  // A rarer token is better evidence, and so is sharing several of them.
  return shared.length * 10 + Math.max(...shared.map((token) => Math.min(token.length, 9)));
}

/**
 * Whether two normalized subjects plausibly identify the same real-world
 * thing: the leading tokens match ("x" / "x-solution" / "x-certifications" all
 * share "x"), or they share any significant token ("couts-infra" and "infra"
 * both carry "infra"). Generic tokens and bare numbers are ignored, so
 * "solution-pricing" and "solution-licence" are not related just because both
 * say "solution".
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
    scope: isExtractionScope(data.scope) ? data.scope : null,
    kind: isExtractionKind(data.kind) ? data.kind : null,
    tags: normalizeTags(data.tags),
  };
}
