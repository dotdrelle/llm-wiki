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
    { id: 'leaf_beta', prefLabel: { fr: 'Beta' }, firstSeenRevision: 1 },
    { id: 'leaf_securite', prefLabel: { fr: 'Sécurité' }, firstSeenRevision: 1 },
  ],
  assignments: {
    'raw/ingested/beta.md': { primaryCommunity: 'leaf_beta' },
    'wiki/concepts/beta-integration.md': { primaryCommunity: 'leaf_beta' },
    // Une page de sécurité citée par la source beta : elle n'est PAS dans
    // la feuille du produit, pourtant la source la cite.
    'wiki/concepts/securite.md': { primaryCommunity: 'leaf_securite' },
  },
  corpusPageIds: [
    'raw/ingested/beta.md',
    'wiki/concepts/beta-integration.md',
    'wiki/concepts/securite.md',
  ],
  sampledPageIds: [
    'raw/ingested/beta.md',
    'wiki/concepts/beta-integration.md',
    'wiki/concepts/securite.md',
  ],
};

describe('couverture d’une source', () => {
  it('distingue les pages qui citent la source de la taille de sa feuille', () => {
    const nodes = [
      node('raw/ingested/beta.md', 'raw-source', 'beta'),
      node('wiki/concepts/beta-integration.md', 'wiki'),
      node('wiki/concepts/securite.md', 'wiki'),
    ];
    const edges = [
      // La source cite la page de sécurité : la source COUVRE sécurité.
      edge('raw/ingested/beta.md', 'wiki/concepts/securite.md', 'cites'),
      // La page d'intégration cite la source.
      edge('wiki/concepts/beta-integration.md', 'raw/ingested/beta.md', 'cites'),
    ];

    const coverage = computeSourceCoverage(nodes, edges, registry);
    const beta = coverage.find((item) => item.id === 'raw/ingested/beta.md')!;

    // Une page cite la source (l'intégration).
    expect(beta.citingPages).toBe(1);
    // Option A : la feuille Beta ne compte plus la source elle-même — le
    // corpus de connaissance est fait de concepts, pas des matières brutes qui
    // les ont produits. Reste le concept d'intégration = 1.
    expect(beta.assignedPages).toBe(1);
    expect(beta.leafId).toBe('leaf_beta');
    expect(beta.subject).toBe('beta');
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
        'raw/ingested/a.md': { primaryCommunity: 'leaf_beta' },
        'raw/ingested/b.md': { primaryCommunity: 'leaf_beta' },
        'wiki/concepts/c.md': { primaryCommunity: 'leaf_beta' },
      },
    };
    const coverage = computeSourceCoverage(nodes, [], twoSources);

    // La feuille compte 1 concept ; chaque source la rapporte, sans la gonfler.
    // Les deux sources brutes ne sont plus comptées dans la feuille (Option A).
    expect(coverage.map((item) => item.assignedPages)).toEqual([1, 1]);
  });
});
