import { normalizeProvenanceValue } from './provenance.ts';
import {
  pickSurvivor,
  deprecateInto,
  summarizeLineage,
  type LineageSummary,
} from '../graph/wiki/taxonomy/filiation.ts';
import type {
  RegistryCommunity,
  TaxonomyRegistry,
} from '../graph/wiki/taxonomy/schema.ts';

/*
 Collection consolidation (plan Lot 3, §6.4 and §8.1).

 The base consolidates source by source: each document decides its own concepts
 without ever seeing those of its neighbours. On a comparative collection — five
 sibling products sharing the same grid — two sources then converge on two pages
 of the same subject, and nobody reconciles them: this is the cross-source
 duplicate §6.4 asks to merge.

 This pass is the DETERMINISTIC and FILIATED part of collection consolidation.
 It manufactures no content: that is the agentic part, bounded to a single
 multi-source pass, which will decide comparative pages and secondary relations
 through a transverse call (§8.1: one consolidation per collection). Here we
 make the identities several sources already produced compatible: a normalized
 subject carried by several sources becomes a merge, with a survivor chosen by
 the stable rule of 6.3, and the absorbed pages are written as deprecated stubs
 pointing to the survivor — never deleted.

 §8.1 bounds the pass to MULTI-SOURCE collections: a single-source collection
 has no cross-source duplicate to reconcile, and merging it would rewrite
 identities nothing contradicts. Two concepts from the SAME source are already
 reconciled by the per-source consolidation; they never count as a cross-source
 duplicate.
*/

/** A collection concept, as the pipeline already produced it. */
export type CollectionConcept = {
  /** Wiki concept page path, e.g. `wiki/concepts/anaplan.md`. */
  path: string;
  /** Normalized page subject (its `subject` provenance). */
  subject: string;
  /** Origin source, e.g. a relative path (for the multi-source bound). */
  source: string;
};

/** A cross-source merge detected on a subject shared by several sources. */
export type CollectionFusion = {
  /** Normalized subject shared by several sources. */
  subject: string;
  /** Candidate pages (grouping order does not influence the choice). */
  candidates: string[];
  /** Survivor chosen by the stable rule of 6.3. */
  survivor: string;
  /** Absorbed pages, written as deprecated stubs pointing to the survivor. */
  absorbed: string[];
};

export type CollectionConsolidation = {
  /** Merges detected on subjects actually shared across sources. */
  fusions: CollectionFusion[];
  /**
   * Before/after report over the collection concepts, AFTER applying the
   * merges: the absorbed ones show up in `merged` toward the survivor.
   */
  lineage: LineageSummary;
};

/**
 * Projects collection concepts into taxonomic communities (§6.3).
 *
 * Each concept becomes a root community carrying its subject. No page is
 * assigned: the before/after report only classifies collection identities, not
 * page distributions — that is the invariant of the pass.
 */
function communitiesFromConcepts(
  concepts: CollectionConcept[],
  firstSeenRevision: number,
): RegistryCommunity[] {
  return concepts.map((concept) => ({
    id: concept.path,
    prefLabel: { fr: concept.subject },
    firstSeenRevision,
  }));
}

/**
 * Detects and resolves the cross-source duplicates of a collection (§6.4).
 *
 * A cross-source duplicate exists when a same normalized subject is carried by
 * concepts originating from DIFFERENT sources of the collection; concepts from
 * a single source are already reconciled by the per-source consolidation and
 * never suffice to trigger a merge. `minSources` transposes §8.1 into a simple
 * rule: by default at least two distinct sources are required.
 *
 * For each subject shared across sources, the survivor is chosen with
 * `pickSurvivor` (stable rule of 6.3) and the other concepts are written as
 * stubs with `deprecateInto`: nothing is deleted, each absorbed concept
 * redirects to the survivor and the survivor records it in `replaces`. The
 * `lineage` report is computed on the state AFTER the merges were applied.
 */
export function consolidateCollection(
  concepts: CollectionConcept[],
  options: { revision: number; minSources?: number },
): CollectionConsolidation {
  const minSources = options.minSources ?? 2;
  const revision = options.revision;
  // All concepts start from the previous revision: it is the base the
  // collection pass applies to, and `pickSurvivor` should not guess an age it
  // cannot know reliably.
  const firstSeenRevision = revision - 1;

  // Grouping by normalized subject, as provenance canonizes it.
  const bySubject = new Map<string, CollectionConcept[]>();
  for (const concept of concepts) {
    const subject = normalizeProvenanceValue(concept.subject);
    if (!subject) continue;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), concept]);
  }

  // Current community state, projected from the concepts: merges are applied
  // one by one (deprecateInto), then frozen for the report.
  let working = communitiesFromConcepts(concepts, firstSeenRevision);

  const fusions: CollectionFusion[] = [];
  for (const [subject, group] of bySubject) {
    if (group.length < 2) continue;
    const sources = new Set(group.map((concept) => concept.source));
    if (sources.size < minSources) continue; // not a cross-source duplicate

    // The survivor is chosen by the stable rule of 6.3, regardless of the
    // grouping order.
    const survivor = pickSurvivor(
      group.map((concept) => ({
        id: concept.path,
        prefLabel: { fr: subject },
        firstSeenRevision,
      })),
    );
    if (!survivor) continue;

    const absorbed: string[] = [];
    for (const concept of group) {
      if (concept.path === survivor) continue;
      const next = deprecateInto(working, {
        id: concept.path,
        replacedBy: survivor,
        revision,
      });
      // `deprecateInto` refuses invalid redirections (target is the concept
      // itself, absent, or already deprecated) and then returns the list
      // unchanged.
      if (next === working) continue;
      working = next;
      absorbed.push(concept.path);
    }
    if (absorbed.length === 0) continue;

    fusions.push({
      subject,
      candidates: group.map((c) => c.path).sort(),
      survivor,
      absorbed: absorbed.sort(),
    });
  }

  // Before/after report faithful to what the pass actually produced.
  const beforeRegistry: TaxonomyRegistry = {
    schemaVersion: 3,
    revision,
    corpus: 'fp:collection',
    corpusAlgorithm: 'sha256',
    languages: ['fr'],
    communities: communitiesFromConcepts(concepts, firstSeenRevision),
    assignments: {},
    corpusPageIds: [],
    sampledPageIds: [],
  };
  const afterRegistry: TaxonomyRegistry = {
    ...beforeRegistry,
    communities: working,
  };
  const lineage = summarizeLineage(beforeRegistry, afterRegistry);

  return { fusions, lineage };
}
