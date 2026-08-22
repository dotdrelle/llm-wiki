import { z } from 'zod';

/*
 Extraction contract: a batch reports FACTS, never files.

 Before, each batch of a source received the full ingestion prompt and decided
 on its own to create pages, update some and touch the index. The operations
 were then concatenated without semantic consolidation: two batches could write
 the same path, or two different paths for the same concept, and nothing
 arbitrated between them. The number of produced pages therefore followed the
 number of batches — that is, the way the titles were split.

 Here, a batch cannot write anything. It reports what it has read, with
 identifiers LOCAL to the document; only the consolidation turns this into
 paths. That is what makes the decision unique per source instead of being
 repeated per fragment.
*/

/** Version of the contract, carried by the cache: a change invalidates the entries. */
export const EXTRACTION_SCHEMA_VERSION = 1;

/**
 * Scope of a candidate subject.
 *
 * `source` stays within the source note; `product` belongs to a compared
 * subject; `transverse` spans several subjects; `workspace` applies to the
 * whole workspace. It is this scope, and not the volume of text, that decides
 * later whether a candidate deserves its own page.
 */
export const EXTRACTION_SCOPES = ['source', 'product', 'transverse', 'workspace'] as const;
export type ExtractionScope = (typeof EXTRACTION_SCOPES)[number];

/**
 * Kind of a candidate subject.
 *
 * `scope` says WHERE a subject's knowledge lives (one document, one product,
 * several, the whole workspace); `kind` says WHAT the subject IS. The two are
 * orthogonal: "Board" is a `product` whose `scope` is `product`, while
 * "Certifications cloud" is a `dimension` whose `scope` is `transverse`.
 *
 * `kind` exists because a taxonomy groups by identity, and identity has a
 * nature. Without it, the consolidation cannot tell "Board" (the product) from
 * "Board International" (the vendor behind it) — two near-duplicate pages for
 * one real-world thing — nor a `dimension` from the `product` it qualifies. A
 * closed vocabulary lets the taxonomy trust the field instead of re-deriving
 * nature from prose.
 */
export const EXTRACTION_KINDS = [
  'vendor',
  'product',
  'requirement',
  'regulation',
  'dimension',
  'scenario',
] as const;
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number];

/**
 * Declared importance, with its justification.
 *
 * Asking for the justification is not decorative: it is what lets the
 * consolidation refuse a candidate without having to reread the fragment, and
 * lets the log explain afterwards why a concept was kept.
 */
export const EXTRACTION_IMPORTANCE = ['core', 'supporting', 'incidental'] as const;

const nonEmpty = z.string().trim().min(1);

/**
 * First non-blank candidate, or `undefined` when none qualifies.
 *
 * `rationale` is a short prose justification the extraction model is asked to
 * provide. When it (and its observed synonyms) are absent or blank, fall back
 * to a deterministic default derived from the subject's own declared scope and
 * importance instead of rejecting the whole source. The rationale is advisory
 * only — it feeds the consolidation prompt's `why:` line, never a published
 * page — so a synthesized fallback cannot invent content.
 */
function firstNonBlank(...candidates: unknown[]): unknown {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return undefined;
}

function defaultSubjectRationale(importance: string, scope: string): string {
  return `Declared as a ${importance} ${scope} subject; the model provided no rationale.`;
}

/*
 * Closed vocabularies must degrade, never reject.

 * `scope` and `importance` are closed vocabularies the model is asked to write
 * verbatim, and a long multi-pack source makes it write one of them wrong (a
 * capitalised form, a near-synonym, a French word) on one subject in ten.
 * Rejecting the whole source for that costs a full re-ingest for a field the
 * consolidation re-evaluates from content anyway. Normalize case, map the
 * near-synonyms observed, and coerce anything else to a safe fallback.
 */
function normalizeClosedVocabulary(
  value: unknown,
  allowed: readonly string[],
  synonyms: Record<string, string>,
  fallback: string,
): string {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if ((allowed as readonly string[]).includes(normalized)) return normalized;
    const mapped = synonyms[normalized];
    if (mapped) return mapped;
  }
  return fallback;
}

const IMPORTANCE_SYNONYMS: Record<string, string> = {
  primary: 'core', principal: 'core', principale: 'core',
  critical: 'core', essential: 'core', high: 'core', major: 'core', majeur: 'core', majeure: 'core',
  secondary: 'supporting', secondaire: 'supporting', medium: 'supporting', normal: 'supporting',
  minor: 'incidental', low: 'incidental', faible: 'incidental', annexe: 'incidental', accessoire: 'incidental',
};

const SCOPE_SYNONYMS: Record<string, string> = {
  transversal: 'transverse', shared: 'transverse', cross: 'transverse',
  global: 'workspace', general: 'workspace',
  document: 'source', doc: 'source', note: 'source',
};

const KIND_SYNONYMS: Record<string, string> = {
  // vendor: the organisation behind a product/solution.
  editor: 'vendor', vendor: 'vendor', supplier: 'vendor', publisher: 'vendor',
  company: 'vendor', organisation: 'vendor', organization: 'vendor', editeur: 'vendor',
  fournisseur: 'vendor', societe: 'vendor', société: 'vendor',
  // product: the compared solution/tool itself.
  solution: 'product', tool: 'product', software: 'product', platform: 'product',
  application: 'product', app: 'product', produit: 'product', logiciel: 'product',
  // requirement: an imperative the subject must satisfy.
  requirement: 'requirement', constraint: 'requirement', criterion: 'requirement',
  exigence: 'requirement', contrainte: 'requirement',
  // regulation: a legal/contractual obligation.
  regulation: 'regulation', compliance: 'regulation', legal: 'regulation',
  obligation: 'regulation', réglementation: 'regulation', conformite: 'regulation',
  // dimension: a shared characteristic studied across subjects.
  dimension: 'dimension', aspect: 'dimension', concern: 'dimension',
  characteristic: 'dimension', caracteristique: 'dimension', security: 'dimension',
  securite: 'dimension', hosting: 'dimension', sovereignty: 'dimension',
  souverainete: 'dimension',
  // scenario: an alternative option under comparison.
  scenario: 'scenario', option: 'scenario', alternative: 'scenario',
  scenari: 'scenario', variant: 'scenario',
};

function normalizeImportance(value: unknown): string {
  return normalizeClosedVocabulary(value, EXTRACTION_IMPORTANCE, IMPORTANCE_SYNONYMS, 'supporting');
}

export function normalizeScope(value: unknown): string {
  return normalizeClosedVocabulary(value, EXTRACTION_SCOPES, SCOPE_SYNONYMS, 'product');
}

export function normalizeKind(value: unknown): string {
  return normalizeClosedVocabulary(value, EXTRACTION_KINDS, KIND_SYNONYMS, 'product');
}

/** Local identifier within the document: `s1`, `s2`… Never a path. */
const localId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/i, 'expected local identifier, never a path');

export const extractedFactSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const fact = value as Record<string, unknown>;
  const triple = fact.predicate !== undefined && fact.object !== undefined
    ? `${String(fact.subject ?? 'subject')} ${String(fact.predicate)}: ${
        Array.isArray(fact.object) ? fact.object.map(String).join(', ') : String(fact.object)
      }`
    : undefined;
  return {
    ...fact,
    statement: fact.statement ?? fact.text ?? fact.content ?? fact.claim ?? triple,
    subject: fact.subject ?? fact.subjectId ?? fact.subject_id,
  };
}, z.object({
  statement: nonEmpty,
  /*
   Local subject the fact attaches to, when there is one.

   Deliberately constrained to a plain string and not `localId`: a model may
   attach the fact to an identifier of imperfect form. The referential purge
   below resolves eligibility (unknown target → subject discarded) without
   losing the source for a dubious form.
  */
  subject: z.string().trim().min(1).nullish().transform((value) => value ?? null),
  /** Canonical citation path, as provided in the user message. */
  citation: nonEmpty,
}));

export const extractedSubjectSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const subject = value as Record<string, unknown>;
  const importance = normalizeImportance(subject.importance);
  const scope = normalizeScope(subject.scope);
  const kind = normalizeKind(subject.kind);
  return {
    ...subject,
    // Some engines omit the label but provide id + scope +
    // justification. The id then stays a PRIVATE marker for the consolidation,
    // never a page name nor a published identity.
    label: subject.label ?? subject.name ?? subject.title ?? subject.id,
    scope,
    kind,
    importance,
    rationale: firstNonBlank(
      subject.rationale,
      subject.justification,
      subject.reason,
      subject.why,
      defaultSubjectRationale(importance, scope),
    ),
    relatedExistingPages:
      subject.relatedExistingPages ?? subject.existingPages ?? subject.related_pages ?? [],
  };
}, z.object({
  id: localId,
  label: nonEmpty,
  scope: z.enum(EXTRACTION_SCOPES),
  kind: z.enum(EXTRACTION_KINDS),
  importance: z.enum(EXTRACTION_IMPORTANCE),
  rationale: nonEmpty,
  /**
   * Existing pages this candidate could extend.
   *
   * A proximity SIGNAL, not a decision: the consolidation verifies that the
   * page exists and decides. Without this signal, each batch would rediscover
   * an already-written concept and the consolidation would have no reason to
   * bring them together.
   */
  relatedExistingPages: z.array(nonEmpty).default([]),
}));

export const extractedRelationSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const relation = value as Record<string, unknown>;
  return {
    ...relation,
    from: relation.from ?? relation.source ?? relation.sourceId
      ?? relation.fromSubject ?? relation.sourceSubject ?? relation.subject1 ?? relation.subject,
    to: relation.to ?? relation.target ?? relation.targetId
      ?? relation.toSubject ?? relation.targetSubject ?? relation.subject2 ?? relation.object,
    kind: relation.kind ?? relation.type ?? relation.relation ?? relation.predicate,
  };
}, z.object({
  from: z.string().trim().min(1).nullish().transform((value) => value ?? null),
  to: z.string().trim().min(1).nullish().transform((value) => value ?? null),
  kind: nonEmpty,
}));

/*
 Input tolerance, same discipline as `ingestPlanSchema`.

 Models happily rename keys from one turn to the next. Repairing here what is
 manifestly the same field avoids a rejection — and therefore one more call —
 for a vocabulary difference that changes no meaning.
*/
/*
 Referential purge: degrade, never reject.

 Relations and the main subject reference a subject only if they reuse its
 declared identifier. A model may emit a target that is not a declared
 identifier — fact id, label, path. Rejecting the source would pay a call in
 vain and lose an entire document for a marker that nobody can resolve. The
 purge discards orphan references and logs them; valid facts, subjects and
 relations survive.

 Returning an orphan reference instead of rejecting follows the same discipline
 as `validateConsolidation`: a STRUCTURE error blocks, a semantic reservation
 is visible without preventing publication.
*/
export const sourceExtractionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const candidate = value as Record<string, unknown>;
    const rawFacts = Array.isArray(candidate.facts ?? candidate.statements ?? candidate.findings)
      ? (candidate.facts ?? candidate.statements ?? candidate.findings) as unknown[]
      : [];
    const rawSubjects = Array.isArray(candidate.subjects ?? candidate.candidates ?? candidate.topics)
      ? (candidate.subjects ?? candidate.candidates ?? candidate.topics) as unknown[]
      : [];
    const rawRelations = Array.isArray(candidate.relations ?? candidate.links)
      ? (candidate.relations ?? candidate.links) as unknown[]
      : [];
    const declaredMain = candidate.mainSubject ?? candidate.main_subject ?? candidate.primarySubject ?? null;
    const resolvedMain = typeof declaredMain === 'string'
      ? rawSubjects.find((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
          const subject = raw as Record<string, unknown>;
          const label = subject.label ?? subject.name ?? subject.title;
          return typeof label === 'string'
            && label.trim().localeCompare(declaredMain.trim(), undefined, { sensitivity: 'base' }) === 0;
        })
      : null;

    const idOf = (raw: unknown): string | null => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const subject = raw as Record<string, unknown>;
      const id = subject.id ?? subject.subjectId ?? subject.subject_id ?? subject.key;
      if (typeof id !== 'string') return null;
      const trimmed = id.trim();
      // Only identifiers of `localId` form will survive the subject validation
      // (`extractedSubjectSchema.id`). A subject with a malformed id will be
      // rejected by the contract a little further down; it must therefore not
      // make a relation or a `mainSubject` "resolved" when its subject will
      // never exist.
      if (!trimmed || !localId.safeParse(trimmed).success) return null;
      return trimmed;
    };
    const subjectIds = new Set<string>();
    for (const raw of rawSubjects) {
      const id = idOf(raw);
      if (id) subjectIds.add(id);
    }
    const isKnown = (ref: unknown): ref is string =>
      typeof ref === 'string' && ref.trim().length > 0 && subjectIds.has(ref.trim());

    let orphanedRelations = 0;
    let orphanedFacts = 0;
    const relations: unknown[] = [];
    for (const raw of rawRelations) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const relation = raw as Record<string, unknown>;
      const from = relation.from ?? relation.source ?? relation.sourceId
        ?? relation.fromSubject ?? relation.sourceSubject ?? relation.subject1 ?? relation.subject;
      const to = relation.to ?? relation.target ?? relation.targetId
        ?? relation.toSubject ?? relation.targetSubject ?? relation.subject2 ?? relation.object;
      if (isKnown(from) && isKnown(to)) {
        relations.push(raw);
      } else {
        orphanedRelations += 1;
      }
    }
    const facts: unknown[] = [];
    for (const raw of rawFacts) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const fact = raw as Record<string, unknown>;
      const subject = fact.subject ?? fact.subjectId ?? fact.subject_id;
      if (subject === undefined || subject === null || isKnown(subject)) {
        // The fact itself is kept as-is; its attachment is already valid or
        // absent.
        facts.push(raw);
      } else {
        // Usable fact, broken attachment: keep the fact, discard only the
        // orphan identifier. The consolidation loses the link, not the
        // content.
        orphanedFacts += 1;
        facts.push({ ...fact, subject: null });
      }
    }

    const mainSubject = resolvedMain && typeof resolvedMain === 'object'
      ? ((resolvedMain as Record<string, unknown>).id as string | undefined) ?? null
      : typeof declaredMain === 'string' && isKnown(declaredMain) ? declaredMain : null;

    return {
      ...candidate,
      facts,
      subjects: rawSubjects,
      relations,
      mainSubject,
      // Visible, never blocking: the trace explains what was discarded.
      ...(orphanedRelations > 0 || orphanedFacts > 0
        ? { _dangling: { orphanedRelations, orphanedFacts } }
        : {}),
    };
  },
  z.object({
    facts: z.array(extractedFactSchema).default([]),
    subjects: z.array(extractedSubjectSchema).default([]),
    relations: z.array(extractedRelationSchema).default([]),
    /** Identity of the main subject when it is explicit in the fragment. */
    mainSubject: localId.nullish().transform((value) => value ?? null),
    /** Counters of ignored references: for logging only, never blocking. */
    _dangling: z.object({
      orphanedRelations: z.number().int().min(0).default(0),
      orphanedFacts: z.number().int().min(0).default(0),
    }).optional(),
  }).superRefine((extraction, context) => {
    const duplicateIds = extraction.subjects
      .map((subject) => subject.id)
      .filter((id, index, all) => all.indexOf(id) !== index);
    for (const id of new Set(duplicateIds)) {
      context.addIssue({ code: 'custom', path: ['subjects'], message: `duplicate local identifier: ${id}` });
    }
  }),
);
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractedSubject = z.infer<typeof extractedSubjectSchema>;
export type ExtractedRelation = z.infer<typeof extractedRelationSchema>;
export type SourceExtraction = z.infer<typeof sourceExtractionSchema>;

/**
 * Merges the extractions of a single source, without deciding anything.
 *
 * Identifiers are local to the BATCH, not to the document: two batches can
 * both name `s1`. They are therefore prefixed by their batch index before
 * being merged, otherwise the consolidation would see a single subject where
 * there are two — or worse, link facts belonging to different subjects.
 *
 * No semantic reconciliation here: that is the consolidation's job, and doing
 * it in two places would mean doing it twice, differently.
 */
export function mergeExtractions(extractions: SourceExtraction[]): SourceExtraction {
  const facts: ExtractedFact[] = [];
  const subjects: ExtractedSubject[] = [];
  const relations: ExtractedRelation[] = [];
  const mainSubjects: string[] = [];

  extractions.forEach((extraction, index) => {
    const qualify = (id: string) => `b${index + 1}_${id}`;
    for (const fact of extraction.facts) {
      facts.push({ ...fact, subject: fact.subject ? qualify(fact.subject) : null });
    }
    for (const subject of extraction.subjects) {
      subjects.push({ ...subject, id: qualify(subject.id) });
    }
    for (const relation of extraction.relations) {
      // A relation without resolved endpoints brings nothing to the merge:
      // purging it here, as at extraction, keeps each batch free of ideas.
      if (!relation.from || !relation.to) continue;
      relations.push({ ...relation, from: qualify(relation.from), to: qualify(relation.to) });
    }
    if (extraction.mainSubject) mainSubjects.push(qualify(extraction.mainSubject));
  });

  return {
    facts,
    subjects,
    relations,
    // Several batches may designate a main subject; the first declared wins,
    // and the consolidation sees the full list anyway.
    mainSubject: mainSubjects[0] ?? null,
  };
}
