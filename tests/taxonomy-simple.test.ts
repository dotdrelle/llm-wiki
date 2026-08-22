import { describe, expect, it } from 'vitest';
import {
  buildRetryPrompt,
  extractTrailingJson,
  toRegistry,
  validateProposal,
} from '../src/graph/wiki/taxonomy/simple.ts';

const pages = [
  { path: 'wiki/concepts/a.md', title: 'Anaplan', frontmatter: {}, excerpt: '', kind: 'product', scope: 'product' },
  { path: 'wiki/concepts/b.md', title: 'Sécurité', frontmatter: {}, excerpt: '', kind: 'dimension', scope: 'transverse' },
  { path: 'wiki/concepts/c.md', title: 'Souveraineté', frontmatter: {}, excerpt: '', kind: 'dimension', scope: 'transverse' },
  { path: 'wiki/sources/d.md', title: 'Étude', frontmatter: {}, excerpt: '', kind: null, scope: 'source' },
];

const valid = {
  domains: [
    { id: 'd1', label: 'Solutions' },
    { id: 'd2', label: 'Conformité' },
  ],
  communities: [
    { id: 'c1', label: 'Anaplan', domain: 'd1' },
    { id: 'c4', label: 'Pigment', domain: 'd1' },
    { id: 'c2', label: 'Sécurité', domain: 'd2' },
    { id: 'c3', label: 'Souveraineté', domain: 'd2' },
  ],
  assignments: {
    'wiki/concepts/a.md': 'c1',
    'wiki/concepts/b.md': 'c2',
    'wiki/concepts/c.md': 'c3',
    'wiki/sources/d.md': 'c4',
  },
};

describe('validateProposal', () => {
  it('accepte une proposition conforme et complète', () => {
    expect(validateProposal(valid, pages, 'fr')).toEqual([]);
  });

  it('détecte une page oubliée et une page inconnue', () => {
    const issues = validateProposal(
      { ...valid, assignments: { 'wiki/concepts/a.md': 'c1', 'wiki/concepts/b.md': 'c2' } },
      pages,
      'fr',
    );
    expect(issues.some((issue) => issue.includes('unassigned page: wiki/concepts/c.md'))).toBe(true);
    expect(issues.some((issue) => issue.includes('unassigned page: wiki/sources/d.md'))).toBe(true);
  });

  it('signale le nombre de mots en trop plutôt qu’un rejet opaque (libellé FR avec articles)', () => {
    // Observé en usage réel : un modèle qui écrit en français dépasse vite la
    // limite avec des articles/prépositions ("Gestion de projet ACPI" = 4
    // mots). Un message "invalid domain label: X" sans la raison ne permet
    // pas au modèle de corriger au retry ; il doit voir qu'il a dépassé de 1.
    const issues = validateProposal(
      { ...valid, domains: [{ id: 'd1', label: 'Gestion de projet ACPI' }, { id: 'd2', label: 'Conformité' }] },
      pages,
      'fr',
    );
    expect(issues.some((issue) => issue.includes('has 4 words') && issue.includes('limit is 2'))).toBe(true);
  });

  it('détecte un libellé de périmètre ou un fourre-tout', () => {
    const issues = validateProposal(
      { ...valid, domains: [{ id: 'd1', label: 'Product' }, { id: 'd2', label: 'Conformité' }] },
      pages,
      'fr',
    );
    expect(issues.some((issue) => issue.includes('scope or a catch-all'))).toBe(true);
  });

  it('détecte un domaine réduit à une seule communauté', () => {
    const issues = validateProposal(
      {
        ...valid,
        communities: [
          { id: 'c1', label: 'Anaplan', domain: 'd1' },
          { id: 'c2', label: 'Sécurité', domain: 'd2' },
        ],
      },
      pages,
      'fr',
    );
    expect(issues.some((issue) => issue.includes('fewer than two communities'))).toBe(true);
  });

  it('détecte une communauté attrape-tout (plus de 4 pages)', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      path: `wiki/concepts/p${i}.md`,
      title: `Page ${i}`,
      frontmatter: {},
      excerpt: '',
      kind: 'product',
      scope: 'product',
    }));
    const proposal = {
      domains: [
        { id: 'd1', label: 'Solutions' },
        { id: 'd2', label: 'Conformité' },
      ],
      communities: [
        { id: 'c1', label: 'Solutions', domain: 'd1' },
        { id: 'c2', label: 'Sécurité', domain: 'd2' },
      ],
      assignments: Object.fromEntries(many.map((page, i) => [page.path, i < 7 ? 'c1' : 'c2'])),
    };
    const issues = validateProposal(proposal, many, 'fr');
    expect(issues.some((issue) => issue.includes('holds 7 pages, limit is 4'))).toBe(true);
  });
});

describe('extractTrailingJson', () => {
  it('extrait le JSON à la fin d’une réponse mixte (passe 1 + self-check + JSON)', () => {
    const raw = [
      'wiki/a.md | Anaplan | produit de planification',
      'wiki/b.md | Sécurité | protection de l’information',
      'SELF-CHECK: pages=2 domains=2',
      '{"domains":[{"id":"d1","label":"Solutions"}],"communities":[{"id":"c1","label":"Anaplan","domain":"d1"}],"assignments":{"wiki/a.md":"c1"}}',
    ].join('\n');
    expect(extractTrailingJson(raw)).toEqual({
      domains: [{ id: 'd1', label: 'Solutions' }],
      communities: [{ id: 'c1', label: 'Anaplan', domain: 'd1' }],
      assignments: { 'wiki/a.md': 'c1' },
    });
  });

  it('extrait le JSON enveloppé dans un bloc markdown', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractTrailingJson(raw)).toEqual({ a: 1 });
  });

  it('choisit le DERNIER bloc markdown, pas le premier (un exemple de format avant la vraie réponse)', () => {
    const raw = 'Format example:\n```json\n{"example":true}\n```\nFinal answer:\n```json\n{"a":2}\n```';
    expect(extractTrailingJson(raw)).toEqual({ a: 2 });
  });

  it('gère un guillemet échappé adjacent à une accolade sans se tromper de frontière de chaîne', () => {
    // `\"{\"` dans une valeur ne doit pas être pris pour une vraie accolade
    // structurelle par le scan arrière.
    const raw = 'preamble\n{"note":"contains \\"{\\" itself"}';
    expect(extractTrailingJson(raw)).toEqual({ note: 'contains "{" itself' });
  });
});

describe('buildRetryPrompt', () => {
  it('reliste les chemins valides au lieu de laisser le modèle corriger à l’aveugle', () => {
    // Chaque tentative est un appel LLM sans historique : si le retry ne
    // reliste pas les chemins, le modèle n’a plus aucun moyen de savoir ce
    // qu’il a le droit d’écrire dans "assignments" et invente sa propre
    // arborescence au lieu de corriger l’erreur signalée.
    const prompt = buildRetryPrompt(pages, ['unknown page assigned: wiki/solutions/board.md']);
    for (const page of pages) {
      expect(prompt).toContain(page.path);
    }
    expect(prompt).toContain('unknown page assigned: wiki/solutions/board.md');
  });

  it('ré-injecte la règle de condensation des labels, pas seulement les erreurs', () => {
    // Symétrique au bug des chemins : un retry qui ne rappelle que « 5 words,
    // limit 2 » laisse le modèle décorer les titres au lieu de condenser.
    const prompt = buildRetryPrompt(pages, ['invalid community label "Branches de production comptable (concept)": label has 5 words, limit is 2']);
    expect(prompt).toContain('at most 2 words');
    expect(prompt).toContain('Condense');
    expect(prompt).toContain('drop articles and qualifiers');
  });

  it('ré-injecte la règle « au moins 2 communautés par domaine », pas seulement l’erreur', () => {
    // Observé en usage réel (run acpi, 2026-08-22) : un domaine "ERP" à une
    // seule communauté rejeté 3 tentatives de suite — le retry ne rappelait
    // ni la borne ni comment la corriger (fusionner ou scinder), seulement
    // le message brut "has fewer than two communities".
    const prompt = buildRetryPrompt(pages, ['domain "ERP" has fewer than two communities']);
    expect(prompt).toContain('AT LEAST 2 communities');
    expect(prompt).toContain('merged into another domain');
  });
});

describe('toRegistry', () => {
  it('produit un registre à deux niveaux avec couverture exacte', () => {
    const registry = toRegistry(valid, 'fr', 'corpus-fp', pages.map((page) => page.path), 7);
    expect(registry.schemaVersion).toBeGreaterThanOrEqual(3);
    expect(registry.revision).toBe(7);
    expect(registry.languages).toEqual(['fr']);
    const domains = registry.communities.filter((community) => community.parentCommunity === null);
    const leaves = registry.communities.filter((community) => community.parentCommunity !== null);
    expect(domains).toHaveLength(2);
    expect(leaves).toHaveLength(4);
    expect(Object.keys(registry.assignments)).toHaveLength(4);
    expect(registry.corpusPageIds).toEqual(pages.map((page) => page.path));
    // Every leaf points at a declared domain.
    for (const leaf of leaves) {
      expect(domains.some((domain) => domain.id === leaf.parentCommunity)).toBe(true);
    }
    // Every assignment points at a leaf.
    for (const assignment of Object.values(registry.assignments)) {
      expect(leaves.some((leaf) => leaf.id === assignment.primaryCommunity)).toBe(true);
    }
  });
});
