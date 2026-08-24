import { KNOWLEDGE_ETAG_ALGORITHM } from './knowledge.ts';
import type { TaxonomyMarker, DirtyFlag } from './store.ts';
import type { TaxonomyRegistry } from './schema.ts';

/*
 Coverage of a page by the published taxonomy.

 "Ungrouped" said a single thing and covered three: a page never
 submitted to the model, a page submitted and not classified, a page that appeared after
 synthesis. The block of about 130 pages observed on a real corpus almost
 entirely fell under the third case — hence a revision gap, not a
 taxonomic decision. One word for three causes makes the diagnosis impossible and
 ends up making the warning useless.

 Four states, four counters, a single `Ungrouped` bubble.
*/

export type PageCoverageState =
  /** Assigned by the fresh registry. */
  | 'classified'
  /** Registry absent, stale, incomparable, or page appeared since. */
  | 'pending-classification'
  /** Fresh registry, corpus page never submitted to the model. */
  | 'outside-sample'
  /** Fresh registry, page submitted, no assignment: a real decision. */
  | 'unclassified';

export type CoverageCounts = Record<PageCoverageState, number>;

/**
 * Synthesis status, the five states the freshness UI presents.
 *
 * A stale `pendingSynthesis` flag means the last synthesis died before
 * publishing — the capability will resume it. While the flag's corpus still
 * matches, the resume is owed and the reader sees `running`; once the corpus
 * moved past it, nothing will resume that particular attempt and the map is
 * `stale` until a fresh one lands.
 */
export type SynthesisStatus = 'fresh' | 'stale' | 'running' | 'failed' | 'absent';

export type CoverageReport = {
  /** Fingerprint of the current corpus. */
  corpus: string;
  /** Fingerprint on which the active registry was computed, if comparable. */
  taxonomizedCorpus: string | null;
  /** True when the two fingerprints are comparable AND equal. */
  fresh: boolean;
  /** The five-state freshness presented to the reader. */
  status: SynthesisStatus;
  states: Map<string, PageCoverageState>;
  counts: CoverageCounts;
};

const EMPTY_COUNTS: CoverageCounts = {
  'classified': 0,
  'pending-classification': 0,
  'outside-sample': 0,
  'unclassified': 0,
};

/**
 * Classifies each page of the current corpus.
 *
 * The registry is only trusted if it is **comparable and fresh**: a fingerprint
 * produced by another algorithm is not a different fingerprint, it is an
 * absence of information, and an absence of information proves no
 * coverage. In that case everything is pending — the honest state until the
 * first v3 publication has happened.
 */
export function computeCoverage(input: {
  corpus: string;
  corpusPageIds: string[];
  marker: TaxonomyMarker | null;
  registry: TaxonomyRegistry | null;
  algorithm?: string;
  /** Pending-synthesis flag, when the last synthesis died unpublished. */
  dirtyFlag?: DirtyFlag | null;
}): CoverageReport {
  const algorithm = input.algorithm ?? KNOWLEDGE_ETAG_ALGORITHM;
  const comparable = input.marker?.corpusAlgorithm === algorithm
    && input.registry?.corpusAlgorithm === algorithm;
  const taxonomizedCorpus = comparable ? (input.registry?.corpus ?? null) : null;
  const fresh = Boolean(comparable && taxonomizedCorpus === input.corpus);

  /*
   Five states, so the reader never has to read two counters and infer.

   - `absent`  — no marker at all: the map is the deterministic projection.
   - `running` — a synthesis died unpublished and its corpus still matches:
     resuming it would classify what is on screen.
   - `failed`  — the flag's corpus no longer matches: the owed work is moot and
     the map cannot claim freshness on its behalf.
   - `fresh`   — comparable AND equal.
   - `stale`   — comparable and the corpus moved, or an incomparable legacy
     registry that proves no coverage.
   */
  let status: SynthesisStatus;
  if (!input.marker) {
    status = 'absent';
  } else if (input.dirtyFlag?.kind === 'pendingSynthesis') {
    status = input.dirtyFlag.corpus === input.corpus ? 'running' : 'failed';
  } else if (fresh) {
    status = 'fresh';
  } else {
    status = 'stale';
  }

  const states = new Map<string, PageCoverageState>();
  const counts: CoverageCounts = { ...EMPTY_COUNTS };
  const registry = fresh ? input.registry : null;
  const sampled = new Set(registry?.sampledPageIds ?? []);
  const known = new Set(registry?.corpusPageIds ?? []);

  for (const page of input.corpusPageIds) {
    let state: PageCoverageState;
    if (!registry) {
      state = 'pending-classification';
    } else if (registry.assignments[page]) {
      state = 'classified';
    } else if (!known.has(page)) {
      // The corpus is fresh but this page was not in it: it arrived
      // between synthesis and reading. Nothing was decided about it.
      state = 'pending-classification';
    } else if (!sampled.has(page)) {
      state = 'outside-sample';
    } else {
      state = 'unclassified';
    }
    states.set(page, state);
    counts[state] += 1;
  }

  return { corpus: input.corpus, taxonomizedCorpus, fresh, status, states, counts };
}

/**
 * Submission order to the model: what has never been judged goes first.
 *
 * Sorting by degree alone is a silent trap. A freshly ingested page
 * is, by construction, the least connected in the corpus: it is therefore always it
 * that the `maxPages` bound excludes, and it is never classified. `outside-sample`
 * would become a permanent parking lot fed by each ingestion — the original
 * defect, under a more honest name.
 *
 * The already-covered pages come last: their previous assignment remains
 * valid and is carried over without a new call. They are not useless for
 * all that — they carry the structure the model recognizes — hence their
 * presence, but after.
 */
export function orderPagesForSampling(
  pages: string[],
  input: {
    /** Pages already assigned by the fresh registry. */
    covered: Set<string>;
    /** Pages left outside the sample in previous passes. */
    previouslyOutsideSample?: Set<string>;
    /** Connection degree, to break ties at equal priority. */
    degree?: Map<string, number>;
  },
): string[] {
  const previouslyOutside = input.previouslyOutsideSample ?? new Set<string>();
  const degree = input.degree ?? new Map<string, number>();
  const priority = (page: string): number => {
    if (!input.covered.has(page) && !previouslyOutside.has(page)) return 0;
    if (previouslyOutside.has(page)) return 1;
    return 2;
  };
  return [...pages].sort((a, b) =>
    priority(a) - priority(b)
    || (degree.get(b) ?? 0) - (degree.get(a) ?? 0)
    // Stable tie-break: two passes on the same corpus must submit the
    // same sample, otherwise the drain is not reproducible.
    || a.localeCompare(b));
}

/**
 * Cumulative sample of a single corpus fingerprint.
 *
 * Without this accumulation, each pass would make the previous sample fall back
 * into `outside-sample`: pass 2 would classify what pass 1 had left, while
 * declassifying what pass 1 had seen, and the drain would oscillate without ever
 * converging. A new fingerprint, for its part, starts over from the corpus it describes.
 */
export function mergeSampledPages(input: {
  previous: TaxonomyRegistry | null;
  corpus: string;
  algorithm?: string;
  current: Iterable<string>;
  corpusPageIds: string[];
}): string[] {
  const algorithm = input.algorithm ?? KNOWLEDGE_ETAG_ALGORITHM;
  const continues = input.previous?.corpus === input.corpus
    && input.previous?.corpusAlgorithm === algorithm;
  const inCorpus = new Set(input.corpusPageIds);
  const merged = new Set<string>();
  if (continues) {
    for (const page of input.previous?.sampledPageIds ?? []) {
      if (inCorpus.has(page)) merged.add(page);
    }
  }
  for (const page of input.current) if (inCorpus.has(page)) merged.add(page);
  return [...merged].sort();
}
