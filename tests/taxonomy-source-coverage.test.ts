import { describe, expect, it } from 'vitest';
import { computeSourceCoverage } from '../src/graph/wiki/taxonomy/sourceCoverage.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import type { WikiGraphEdge, WikiGraphNode } from '../src/graph/wiki/projection.ts';

/*
 Couverture d'une source, indépendante de la taille de sa feuille.

 Une feuille produit peut grossir par des pages qui partagent un `group:` sans
 qu'aucune ne cite la source elle-même ; inversement une source peut être citée
 par des pages dispersées sur plusieurs feuilles. `citingPages` mesure la
 couverture de la source, `assignedPages` la taille de sa feuille : leur
 différence est de l'information, jamais une erreur à masquer.
*/

function node(id: string, type: WikiGraphNode['type'], subject: string | null = null): WikiGraphNode {
  return {
    id,
    title: id,
    type,
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    subject,
    collection: null,
    scope: null,
    community: { communityId: 'ungrouped', communityLabel: 'Ungrouped', assignment: 'fallback' },
    degree: 0,
    x: 0,
    y: 0,
    r: 10,
    ring: 1,
    secondary: id,
    inbound: 0,
    outbound: 0,
  };
}

function edge(from: string, to: string, type: WikiGraphEdge['type']): WikiGraphEdge {
  return { from, to, type };
}

const registry: TaxonomyRegistry = {
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  revision: 1,
  corpus: 'c1',
  corpusAlgorithm: 'knowledge-content-sha256-v1',
  languages: ['fr'],
  communities: [
    { id: 'leaf_prophix', prefLabel: { fr: 'Prophix' }, firstSeenRevision: 1 },
    { id: 'leaf_securite', prefLabel: { fr: 'Sécurité' }, firstSeenRevision: 1 },
  ],
  assignments: {
    'raw/ingested/prophix.md': { primaryCommunity: 'leaf_prophix' },
    'wiki/concepts/prophix-integration.md': { primaryCommunity: 'leaf_prophix' },
    // Une page de sécurité citée par la source prophix : elle n'est PAS dans
    // la feuille du produit, pourtant la source la cite.
    'wiki/concepts/securite.md': { primaryCommunity: 'leaf_securite' },
  },
  corpusPageIds: [
    'raw/ingested/prophix.md',
    'wiki/concepts/prophix-integration.md',
    'wiki/concepts/securite.md',
  ],
  sampledPageIds: [
    'raw/ingested/prophix.md',
    'wiki/concepts/prophix-integration.md',
    'wiki/concepts/securite.md',
  ],
};

describe('couverture d’une source', () => {
  it('distingue les pages qui citent la source de la taille de sa feuille', () => {
    const nodes = [
      node('raw/ingested/prophix.md', 'raw-source', 'prophix'),
      node('wiki/concepts/prophix-integration.md', 'wiki'),
      node('wiki/concepts/securite.md', 'wiki'),
    ];
    const edges = [
      // La source cite la page de sécurité : la source COUVRE sécurité.
      edge('raw/ingested/prophix.md', 'wiki/concepts/securite.md', 'cites'),
      // La page d'intégration cite la source.
      edge('wiki/concepts/prophix-integration.md', 'raw/ingested/prophix.md', 'cites'),
    ];

    const coverage = computeSourceCoverage(nodes, edges, registry);
    const prophix = coverage.find((item) => item.id === 'raw/ingested/prophix.md')!;

    // Une page cite la source (l'intégration).
    expect(prophix.citingPages).toBe(1);
    // La feuille Prophix compte la source + l'intégration = 2.
    expect(prophix.assignedPages).toBe(2);
    expect(prophix.leafId).toBe('leaf_prophix');
    expect(prophix.subject).toBe('prophix');
  });

  it('ne compte une citation que si la cible est bien une source', () => {
    const nodes = [node('wiki/concepts/a.md', 'wiki'), node('wiki/concepts/b.md', 'wiki')];
    const edges = [edge('wiki/concepts/a.md', 'wiki/concepts/b.md', 'cites')];

    expect(computeSourceCoverage(nodes, edges, registry)).toEqual([]);
  });

  it('rend assignedPages à zéro sans registre, mais garde les citations', () => {
    const nodes = [node('raw/ingested/x.md', 'raw-source'), node('wiki/concepts/y.md', 'wiki')];
    const edges = [edge('wiki/concepts/y.md', 'raw/ingested/x.md', 'generated_from')];

    const coverage = computeSourceCoverage(nodes, edges, null);
    expect(coverage[0]).toMatchObject({ citingPages: 1, assignedPages: 0, leafId: null });
  });

  it('compte une feuille partagée par plusieurs sources sans la dupliquer', () => {
    const nodes = [
      node('raw/ingested/a.md', 'raw-source'),
      node('raw/ingested/b.md', 'raw-source'),
      node('wiki/concepts/c.md', 'wiki'),
    ];
    const twoSources = {
      ...registry,
      assignments: {
        'raw/ingested/a.md': { primaryCommunity: 'leaf_prophix' },
        'raw/ingested/b.md': { primaryCommunity: 'leaf_prophix' },
        'wiki/concepts/c.md': { primaryCommunity: 'leaf_prophix' },
      },
    };
    const coverage = computeSourceCoverage(nodes, [], twoSources);

    // La feuille compte 3 pages ; chaque source la rapporte, sans la gonfler.
    expect(coverage.map((item) => item.assignedPages)).toEqual([3, 3]);
  });
});
