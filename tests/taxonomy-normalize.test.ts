import { describe, expect, it } from 'vitest';
import { normalizeProposal, type TaxonomyProposal } from '../src/graph/wiki/taxonomy/synthesize.ts';

/*
 Three ACPI syntheses in a row were rejected for "community without a family".

 A leaf with no family assigned carries no page: removing it moves nothing, loses
 nothing, decides no question of meaning. Rejecting the whole proposal — and
 paying three calls — for one extra line was disproportionate.

 The line kept: the engine may REMOVE what carries nothing; it must never invent
 nor move what carries something.
*/

const proposal = (over: Partial<TaxonomyProposal> = {}): TaxonomyProposal => ({
  domains: [{ id: 'd1', label: 'Produit' }, { id: 'd2', label: 'Finance' }],
  communities: [
    { id: 'c1', label: 'Alpha', domain: 'd1' },
    { id: 'c2', label: 'Beta', domain: 'd1' },
    { id: 'c3', label: 'Budget', domain: 'd2' },
  ],
  assignments: { f1: 'c1', f2: 'c3' },
  ...over,
});

describe('normalisation avant validation', () => {
  it('retire une communauté qui ne porte aucune famille', () => {
    const { proposal: cleaned, dropped } = normalizeProposal(proposal());

    expect(cleaned.communities.map((item) => item.id)).toEqual(['c1', 'c3']);
    expect(dropped).toContain('community:c2');
  });

  it('retire le domaine que ce nettoyage a vidé', () => {
    const { proposal: cleaned, dropped } = normalizeProposal(
      proposal({ assignments: { f1: 'c3' } }),
    );

    // d1 n'a plus aucune communauté : il n'ouvrirait sur rien.
    expect(cleaned.domains.map((item) => item.id)).toEqual(['d2']);
    expect(dropped).toContain('domain:d1');
  });

  it('ne touche jamais aux affectations', () => {
    const { proposal: cleaned } = normalizeProposal(proposal());

    // Aucune page ne bouge : c'est la limite exacte de ce que le moteur
    // s'autorise sans décider à la place du modèle.
    expect(cleaned.assignments).toEqual({ f1: 'c1', f2: 'c3' });
  });

  it('ne change rien quand tout est utilisé', () => {
    const full = proposal({ assignments: { f1: 'c1', f2: 'c2', f3: 'c3' } });
    const { proposal: cleaned, dropped } = normalizeProposal(full);

    expect(dropped).toEqual([]);
    expect(cleaned.communities).toHaveLength(3);
  });

  it('laisse la validation parler quand il ne resterait rien', () => {
    // Vider entièrement la proposition produirait un objet hors schéma ; on
    // rend l'original et le contrôle dira ce qui ne va pas.
    const { proposal: cleaned, dropped } = normalizeProposal(proposal({ assignments: {} }));

    expect(dropped).toEqual([]);
    expect(cleaned.communities).toHaveLength(3);
  });

  /*
   Un domaine à une seule communauté survit à la normalisation : ce n'est pas
   une ligne en trop mais une structure trop mince, et elle se corrige plus
   tard en promouvant l'enfant unique au rang de racine — pas en rejetant.
  */
  it('conserve un domaine à une seule communauté, aplati plus tard', () => {
    const { proposal: cleaned } = normalizeProposal(proposal({ assignments: { f1: 'c1', f2: 'c3' } }));

    expect(cleaned.communities.filter((item) => item.domain === 'd1')).toHaveLength(1);
    expect(cleaned.domains.map((item) => item.id)).toContain('d1');
  });
});

describe('domaine trop mince', () => {
  /*
   Trois rejets ACPI successifs ont porté sur des défauts de FORME que le
   moteur savait corriger : une feuille vide, puis un domaine à un seul enfant.
   Chacun coûtait trois appels au modèle pour un résultat que personne
   n'aurait contesté.

   La règle qui en découle : le moteur retire ou aplatit ce qui ne porte rien
   et ne sépare rien ; il ne rejette que ce qui touche au SENS — une page
   inventée, une page affectée deux fois, une couverture incomplète, une
   collision de libellés, une identité effacée.
  */
  it('n’est plus une raison de rejeter une proposition', async () => {
    const { checkProposal } = await import('../src/graph/wiki/taxonomy/synthesize.ts');
    const inventory = {
      language: 'fr',
      corpus: 'c',
      pageCount: 2,
      pages: [],
      families: [
        { id: 'f1', members: ['a.md'], titles: ['a'], signals: [], collections: [], distinctiveTerms: [], neighbours: [] },
        { id: 'f2', members: ['b.md'], titles: ['b'], signals: [], collections: [], distinctiveTerms: [], neighbours: [] },
      ],
      communities: [],
      truncated: false,
    };

    const result = checkProposal(
      {
        domains: [{ id: 'd1', label: 'Alpha' }, { id: 'd2', label: 'Beta' }],
        communities: [
          { id: 'c1', label: 'Un', domain: 'd1' },
          { id: 'c2', label: 'Deux', domain: 'd2' },
        ],
        assignments: { f1: 'c1', f2: 'c2' },
      },
      inventory as never,
    );

    expect(result.ok).toBe(true);
  });
});
