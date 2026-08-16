import { describe, expect, it } from 'vitest';
import {
  computeCoverage,
  mergeSampledPages,
  orderPagesForSampling,
} from '../src/graph/wiki/taxonomy/coverage.ts';
import { KNOWLEDGE_ETAG_ALGORITHM } from '../src/graph/wiki/taxonomy/knowledge.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import type { TaxonomyMarker } from '../src/graph/wiki/taxonomy/store.ts';

/*
 Quatre états, parce qu'« Ungrouped » en couvrait trois.

 Sur ACPI, environ 130 pages étaient affichées comme non classées : la quasi
 totalité relevait d'un écart de révision — le registre avait été publié la
 veille, les pages réingérées le lendemain. Un seul mot pour trois causes rend
 le diagnostic impossible, et un compteur qu'on ne peut pas interpréter finit
 par ne plus être lu.
*/

const marker = (corpus: string, algorithm?: string): TaxonomyMarker => ({
  revision: 3,
  corpus,
  ...(algorithm ? { corpusAlgorithm: algorithm } : {}),
  registryRef: 'communities.abc.json',
  registryHash: 'abc',
  publishedAt: 0,
});

function registry(overrides: Partial<TaxonomyRegistry> = {}): TaxonomyRegistry {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 3,
    corpus: 'corpus-1',
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    languages: ['fr'],
    communities: [{ id: 'cmty_1', prefLabel: { fr: 'Sécurité' }, firstSeenRevision: 1 }],
    assignments: { 'wiki/a.md': { primaryCommunity: 'cmty_1' } },
    corpusPageIds: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'],
    sampledPageIds: ['wiki/a.md', 'wiki/b.md'],
    ...overrides,
  };
}

describe('quatre états de couverture', () => {
  it('sépare classée, hors échantillon et non classée sur un registre frais', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
    });

    expect(report.fresh).toBe(true);
    expect(report.states.get('wiki/a.md')).toBe('classified');
    // Soumise au modèle, non retenue : c'est une décision, elle seule mérite
    // la bulle `Ungrouped`.
    expect(report.states.get('wiki/b.md')).toBe('unclassified');
    // Jamais soumise : accuser la synthèse d'un budget d'échantillonnage
    // reviendrait à lui reprocher une décision qu'elle n'a pas prise.
    expect(report.states.get('wiki/c.md')).toBe('outside-sample');
    expect(report.counts).toMatchObject({
      'classified': 1,
      'unclassified': 1,
      'outside-sample': 1,
      'pending-classification': 0,
    });
  });

  it('met en attente une page apparue après la synthèse', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md', 'wiki/neuve.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
    });

    expect(report.states.get('wiki/neuve.md')).toBe('pending-classification');
    expect(report.counts.unclassified).toBe(1);
  });

  it('met tout en attente quand le corpus a bougé', () => {
    const report = computeCoverage({
      corpus: 'corpus-2',
      corpusPageIds: ['wiki/a.md', 'wiki/b.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
    });

    expect(report.fresh).toBe(false);
    expect(report.counts['pending-classification']).toBe(2);
    expect(report.counts.unclassified).toBe(0);
  });

  it('traite un marqueur d’un autre algorithme comme une absence d’information', () => {
    /*
     Un registre v2 et son marqueur large ne prouvent aucune couverture. Les
     déclarer périmés serait un hasard heureux ; les déclarer frais serait faux.
     Tout est en attente jusqu'à la première publication v3.
    */
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-1'),
      registry: registry({ corpusAlgorithm: 'legacy' }),
    });

    expect(report.fresh).toBe(false);
    expect(report.taxonomizedCorpus).toBeNull();
    expect(report.states.get('wiki/a.md')).toBe('pending-classification');
  });

  it('met tout en attente sans registre du tout', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: null,
      registry: null,
    });

    expect(report.counts['pending-classification']).toBe(1);
  });
});

describe('cinq états de fraîcheur', () => {
  it('dit « absent » sans marqueur du tout', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: null,
      registry: null,
    });

    expect(report.status).toBe('absent');
  });

  it('dit « frais » sur une empreinte comparable et égale', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
    });

    expect(report.status).toBe('fresh');
  });

  it('dit « périmé » quand le corpus a bougé', () => {
    const report = computeCoverage({
      corpus: 'corpus-2',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
    });

    expect(report.status).toBe('stale');
  });

  it('dit « en cours » quand une synthèse morte attend sur le même corpus', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
      dirtyFlag: { kind: 'pendingSynthesis', corpus: 'corpus-1', baseRevision: 3, at: 1 },
    });

    expect(report.status).toBe('running');
  });

  it('dit « échouée » quand le drapeau parle d’un corpus dépassé', () => {
    const report = computeCoverage({
      corpus: 'corpus-2',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-2', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry({ corpus: 'corpus-2' }),
      dirtyFlag: { kind: 'pendingSynthesis', corpus: 'corpus-1', baseRevision: 3, at: 1 },
    });

    expect(report.status).toBe('failed');
  });

  it('ignore un drapeau déterministe : il ne reflète pas une synthèse en attente', () => {
    const report = computeCoverage({
      corpus: 'corpus-1',
      corpusPageIds: ['wiki/a.md'],
      marker: marker('corpus-1', KNOWLEDGE_ETAG_ALGORITHM),
      registry: registry(),
      dirtyFlag: { kind: 'deterministic', corpus: 'corpus-1', baseRevision: 3, at: 1 },
    });

    expect(report.status).toBe('fresh');
  });
});

describe('ordre de soumission au modèle', () => {
  it('fait passer devant ce qui n’a jamais été jugé', () => {
    /*
     Le tri par degré seul est un piège : une page fraîchement ingérée est la
     moins connectée du corpus, donc toujours celle que la borne écarte. Elle ne
     serait jamais classée, et `outside-sample` deviendrait un parking alimenté
     par chaque ingestion.
    */
    const ordered = orderPagesForSampling(
      ['wiki/vieille.md', 'wiki/neuve.md', 'wiki/recalee.md'],
      {
        covered: new Set(['wiki/vieille.md']),
        previouslyOutsideSample: new Set(['wiki/recalee.md']),
        degree: new Map([['wiki/vieille.md', 50], ['wiki/neuve.md', 0], ['wiki/recalee.md', 1]]),
      },
    );

    expect(ordered).toEqual(['wiki/neuve.md', 'wiki/recalee.md', 'wiki/vieille.md']);
  });

  it('reste déterministe à priorité et degré égaux', () => {
    const input = ['wiki/b.md', 'wiki/a.md'];
    const options = { covered: new Set<string>() };
    expect(orderPagesForSampling(input, options)).toEqual(orderPagesForSampling(input, options));
    expect(orderPagesForSampling(input, options)).toEqual(['wiki/a.md', 'wiki/b.md']);
  });
});

describe('échantillon cumulé', () => {
  it('additionne les passes d’une même empreinte de corpus', () => {
    /*
     Sans cumul, la passe 2 classerait ce que la passe 1 a laissé tout en
     faisant retomber l'échantillon de la passe 1 hors échantillon : la vidange
     oscillerait sans jamais converger.
    */
    const merged = mergeSampledPages({
      previous: registry(),
      corpus: 'corpus-1',
      current: ['wiki/c.md'],
      corpusPageIds: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'],
    });

    expect(merged).toEqual(['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
  });

  it('repart de zéro sur une empreinte nouvelle', () => {
    const merged = mergeSampledPages({
      previous: registry(),
      corpus: 'corpus-2',
      current: ['wiki/c.md'],
      corpusPageIds: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'],
    });

    expect(merged).toEqual(['wiki/c.md']);
  });

  it('ne conserve jamais une page sortie du corpus', () => {
    const merged = mergeSampledPages({
      previous: registry(),
      corpus: 'corpus-1',
      current: [],
      corpusPageIds: ['wiki/a.md'],
    });

    expect(merged).toEqual(['wiki/a.md']);
  });
});
