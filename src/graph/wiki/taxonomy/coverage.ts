import { KNOWLEDGE_ETAG_ALGORITHM } from './knowledge.ts';
import type { TaxonomyMarker } from './store.ts';
import type { TaxonomyRegistry } from './schema.ts';

/*
 Couverture d'une page par la taxonomie publiée.

 « Ungrouped » disait une seule chose et en couvrait trois : une page jamais
 soumise au modèle, une page soumise et non classée, une page apparue après la
 synthèse. Le bloc d'environ 130 pages observé sur ACPI relevait presque
 entièrement du troisième cas — donc d'un écart de révision, pas d'une décision
 taxonomique. Un seul mot pour trois causes rend le diagnostic impossible et
 finit par rendre l'avertissement inutile.

 Quatre états, quatre compteurs, une seule bulle `Ungrouped`.
*/

export type PageCoverageState =
  /** Affectée par le registre frais. */
  | 'classified'
  /** Registre absent, périmé, incomparable, ou page apparue depuis. */
  | 'pending-classification'
  /** Registre frais, page du corpus jamais soumise au modèle. */
  | 'outside-sample'
  /** Registre frais, page soumise, aucune affectation : une vraie décision. */
  | 'unclassified';

export type CoverageCounts = Record<PageCoverageState, number>;

export type CoverageReport = {
  /** Empreinte du corpus courant. */
  corpus: string;
  /** Empreinte sur laquelle le registre actif a été calculé, si comparable. */
  taxonomizedCorpus: string | null;
  /** Vrai quand les deux empreintes sont comparables ET égales. */
  fresh: boolean;
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
 * Classe chaque page du corpus courant.
 *
 * Le registre n'est cru que s'il est **comparable et frais** : une empreinte
 * produite par un autre algorithme n'est pas une empreinte différente, c'est une
 * absence d'information, et une absence d'information ne prouve aucune
 * couverture. Dans ce cas tout est en attente — l'état honnête tant que la
 * première publication v3 n'a pas eu lieu.
 */
export function computeCoverage(input: {
  corpus: string;
  corpusPageIds: string[];
  marker: TaxonomyMarker | null;
  registry: TaxonomyRegistry | null;
  algorithm?: string;
}): CoverageReport {
  const algorithm = input.algorithm ?? KNOWLEDGE_ETAG_ALGORITHM;
  const comparable = input.marker?.corpusAlgorithm === algorithm
    && input.registry?.corpusAlgorithm === algorithm;
  const taxonomizedCorpus = comparable ? (input.registry?.corpus ?? null) : null;
  const fresh = Boolean(comparable && taxonomizedCorpus === input.corpus);

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
      // Le corpus est frais mais cette page n'y figurait pas : elle est arrivée
      // entre la synthèse et la lecture. Rien n'a été décidé à son sujet.
      state = 'pending-classification';
    } else if (!sampled.has(page)) {
      state = 'outside-sample';
    } else {
      state = 'unclassified';
    }
    states.set(page, state);
    counts[state] += 1;
  }

  return { corpus: input.corpus, taxonomizedCorpus, fresh, states, counts };
}

/**
 * Ordre de soumission au modèle : ce qui n'a jamais été jugé passe devant.
 *
 * Le tri par degré seul est un piège silencieux. Une page fraîchement ingérée
 * est, par construction, la moins connectée du corpus : c'est donc toujours elle
 * que la borne `maxPages` écarte, et elle n'est jamais classée. `outside-sample`
 * deviendrait un parking permanent alimenté par chaque ingestion — le défaut
 * d'origine, sous un nom plus honnête.
 *
 * Les pages déjà couvertes ferment la marche : leur affectation précédente reste
 * valable et se reconduit sans nouvel appel. Elles ne sont pas inutiles pour
 * autant — elles portent la structure que le modèle reconnaît — d'où leur
 * présence, mais après.
 */
export function orderPagesForSampling(
  pages: string[],
  input: {
    /** Pages déjà affectées par le registre frais. */
    covered: Set<string>;
    /** Pages restées hors échantillon aux passes précédentes. */
    previouslyOutsideSample?: Set<string>;
    /** Degré de connexion, pour départager à priorité égale. */
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
    // Départage stable : deux passes sur le même corpus doivent soumettre le
    // même échantillon, sinon la vidange n'est pas reproductible.
    || a.localeCompare(b));
}

/**
 * Échantillon cumulé d'une même empreinte de corpus.
 *
 * Sans ce cumul, chaque passe ferait retomber l'échantillon précédent dans
 * `outside-sample` : la passe 2 classerait ce que la passe 1 avait laissé, en
 * déclassant ce que la passe 1 avait vu, et la vidange oscillerait sans jamais
 * converger. Une empreinte nouvelle repart, elle, du corpus qu'elle décrit.
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
