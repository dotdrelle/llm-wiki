import { describe, expect, it } from 'vitest';
import { deprecateMissing, membersByCommunity } from '../src/graph/wiki/taxonomy/identity.ts';
import { reattachOrphanedChildren } from '../src/graph/wiki/taxonomy/run.ts';
import {
  validateRegistry,
  REGISTRY_SCHEMA_VERSION,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from '../src/graph/wiki/taxonomy/schema.ts';
import { withCoverage } from './support/registryCoverage.ts';

/*
 La dépréciation date du registre plat.

 Elle n'a jamais été relue quand le registre est devenu un arbre, et elle
 raisonne sur `assignments`, qui ne nomme QUE des feuilles. Un domaine y a donc
 zéro membre — alors qu'il en a plus qu'aucune de ses filles — ce qui rendait
 tout recouvrement nul et faisait tomber la redirection sur un repli arbitraire.

 C'est le même angle mort que `visible()` et l'index de gauche : « un
 identifiant de communauté est une feuille ». Troisième fois.
*/
function registry(): TaxonomyRegistry {
  return withCoverage({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 4,
    corpus: 'sha1:base',
    languages: ['fr'],
    communities: [
      { id: 'dom_solution', prefLabel: { fr: 'Solution' }, firstSeenRevision: 1, parentCommunity: null },
      { id: 'cmty_a', prefLabel: { fr: 'A' }, firstSeenRevision: 1, parentCommunity: 'dom_solution' },
      { id: 'cmty_b', prefLabel: { fr: 'B' }, firstSeenRevision: 1, parentCommunity: 'dom_solution' },
      { id: 'dom_reseau', prefLabel: { fr: 'Reseau' }, firstSeenRevision: 1, parentCommunity: null },
      { id: 'cmty_topo', prefLabel: { fr: 'Topologie' }, firstSeenRevision: 1, parentCommunity: 'dom_reseau' },
    ],
    assignments: {
      'wiki/a1.md': { primaryCommunity: 'cmty_a' },
      'wiki/a2.md': { primaryCommunity: 'cmty_a' },
      'wiki/b1.md': { primaryCommunity: 'cmty_b' },
      'wiki/t1.md': { primaryCommunity: 'cmty_topo' },
    },
  });
}

describe('membres d’une communauté', () => {
  it('remonte les pages d’une feuille jusqu’à son domaine', () => {
    const members = membersByCommunity(registry());

    expect(members.get('cmty_a')!.sort()).toEqual(['wiki/a1.md', 'wiki/a2.md']);
    // Le domaine porte l'union de ses filles. C'est ce zéro qui cassait tout.
    expect(members.get('dom_solution')!.sort()).toEqual(['wiki/a1.md', 'wiki/a2.md', 'wiki/b1.md']);
  });

  it('laisse une feuille inchangée', () => {
    expect(membersByCommunity(registry()).get('cmty_topo')).toEqual(['wiki/t1.md']);
  });
});

describe('redirection d’une communauté disparue', () => {
  it('pointe vers celle qui a repris ses pages', () => {
    const stubs = deprecateMissing(
      registry(),
      [
        { id: 'cmty_fusion', members: ['wiki/a1.md', 'wiki/a2.md', 'wiki/b1.md'], label: 'Fusion', reanchored: false },
        { id: 'dom_solution', members: ['wiki/a1.md', 'wiki/a2.md', 'wiki/b1.md'], label: 'Solution', reanchored: true },
        { id: 'dom_reseau', members: ['wiki/t1.md'], label: 'Reseau', reanchored: true },
        { id: 'cmty_topo', members: ['wiki/t1.md'], label: 'Topologie', reanchored: true },
      ],
      5,
    );
    const byId = new Map(stubs.map((item) => [item.id, item]));

    expect(byId.get('cmty_a')!.replacedBy).toBe('cmty_fusion');
    expect(byId.get('cmty_a')!.changeNote!.at(-1)!.kind).toBe('merged');
  });

  /*
   Le cœur du correctif #2. Un domaine dont le recouvrement est nul par
   construction se voyait attribuer `survivors[0]` — la PREMIÈRE communauté de
   la liste, sans aucun rapport. Un lecteur revenant avec un identifiant ancien
   atterrissait donc en silence ailleurs.
  */
  it('ne redirige plus un domaine vers un survivant arbitraire', () => {
    const before = registry();
    const stubs = deprecateMissing(
      before,
      // Aucun survivant ne reprend les pages de `dom_reseau` / `cmty_topo`.
      [{ id: 'cmty_sans_rapport', members: ['wiki/z.md'], label: 'Ailleurs', reanchored: false }],
      5,
    );
    const topo = stubs.find((item) => item.id === 'cmty_topo')!;
    const reseau = stubs.find((item) => item.id === 'dom_reseau')!;

    expect(topo.replacedBy).toBeNull();
    expect(topo.changeNote!.at(-1)!.kind).toBe('removed');
    expect(reseau.replacedBy).toBeNull();
    // Et surtout : jamais la communauté sans rapport.
    for (const stub of stubs) expect(stub.replacedBy).not.toBe('cmty_sans_rapport');
  });

  it('replie sur le parent survivant à défaut de recouvrement', () => {
    const stubs = deprecateMissing(
      registry(),
      // Le domaine survit, la feuille disparaît sans que personne ne reprenne
      // ses pages : le parent est le plus proche candidat honnête.
      [{ id: 'dom_solution', members: [], label: 'Solution', reanchored: true }],
      5,
    );
    const leaf = stubs.find((item) => item.id === 'cmty_a')!;

    expect(leaf.replacedBy).toBe('dom_solution');
    expect(leaf.changeNote!.at(-1)!.kind).toBe('reparented');
  });
});

/*
 Une feuille préservée ne doit pas pendre à un parent mort.

 Une communauté entièrement hors échantillon traverse la révision intacte — y
 compris son `parentCommunity`. Mais une AUTRE feuille du même domaine, elle
 échantillonnée, peut avoir fait remplacer ou déprécier ce domaine. La feuille
 restait active en pointant vers un mort : le registre passait la validation, et
 pourtant `communityHierarchy` ne bâtit l'arbre qu'avec les communautés actives.
 Le parent était introuvable, la feuille quittait la hiérarchie et remontait en
 bulle racine — un registre qui décrit deux arbres différents selon qui le lit.
*/
describe('feuille dont le domaine a disparu', () => {
  const orphan = (): RegistryCommunity[] => [
    { id: 'dom_mort', prefLabel: { fr: 'Ancien' }, firstSeenRevision: 1, parentCommunity: null, deprecated: true, replacedBy: 'dom_vivant' },
    { id: 'dom_vivant', prefLabel: { fr: 'Nouveau' }, firstSeenRevision: 2, parentCommunity: null },
    { id: 'cmty_preservee', prefLabel: { fr: 'Preservee' }, firstSeenRevision: 1, parentCommunity: 'dom_mort' },
  ];

  it('suit la redirection du domaine jusqu’à une racine vivante', () => {
    const communities = orphan();
    reattachOrphanedChildren(communities);

    expect(communities.find((item) => item.id === 'cmty_preservee')!.parentCommunity).toBe('dom_vivant');
  });

  it('promeut la feuille en racine quand plus rien ne survit', () => {
    const communities = orphan();
    communities[0]!.replacedBy = null;
    reattachOrphanedChildren(communities);

    // Racine plutôt que suspendue : le schéma l'autorise, et la carte
    // l'affiche comme une bulle ordinaire au lieu de la perdre.
    expect(communities.find((item) => item.id === 'cmty_preservee')!.parentCommunity).toBeNull();
  });

  it('ne raccroche jamais une feuille sous une autre feuille', () => {
    const communities = orphan();
    // La cible de remplacement est elle-même une feuille : s'y accrocher
    // creuserait un troisième niveau que le schéma interdit.
    communities[1]!.parentCommunity = 'dom_autre';
    communities.push({ id: 'dom_autre', prefLabel: { fr: 'Autre' }, firstSeenRevision: 2, parentCommunity: null });
    reattachOrphanedChildren(communities);

    expect(communities.find((item) => item.id === 'cmty_preservee')!.parentCommunity).toBeNull();
  });

  it('laisse intacte une feuille dont le domaine est vivant', () => {
    const communities = orphan();
    communities[2]!.parentCommunity = 'dom_vivant';
    reattachOrphanedChildren(communities);

    expect(communities.find((item) => item.id === 'cmty_preservee')!.parentCommunity).toBe('dom_vivant');
  });

  it('refuse désormais à la validation un enfant actif sous un parent déprécié', () => {
    const data = registry();
    data.communities = orphan();
    data.assignments = { 'wiki/a.md': { primaryCommunity: 'cmty_preservee' } };

    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.reason.includes('deprecated parent domain'))).toBe(true);
  });
});

describe('registre validé', () => {
  /*
   La règle « déprécié ⇒ remplaçant obligatoire » est ce qui FORÇAIT l'invention
   d'une redirection fausse. `resolveCommunity` s'arrête proprement sur un
   `replacedBy` nul et rend le concept déprécié lui-même.
  */
  it('accepte une communauté dépréciée sans successeur', () => {
    const data = registry();
    data.communities.push({
      id: 'cmty_disparue',
      prefLabel: { fr: 'Disparue' },
      firstSeenRevision: 1,
      parentCommunity: null,
      deprecated: true,
      replacedBy: null,
    });

    const result = validateRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('refuse toujours un successeur qui n’existe pas', () => {
    const data = registry();
    data.communities.push({
      id: 'cmty_disparue',
      prefLabel: { fr: 'Disparue' },
      firstSeenRevision: 1,
      parentCommunity: null,
      deprecated: true,
      replacedBy: 'cmty_fantome',
    });

    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.reason.includes('unknown target'))).toBe(true);
  });
});
