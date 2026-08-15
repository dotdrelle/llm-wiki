import { describe, expect, it } from 'vitest';
import {
  anchorCommunities,
  deprecateMissing,
  isCommunityId,
  memberOverlap,
  newCommunityId,
} from '../src/graph/wiki/taxonomy/identity.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import { withCoverage } from './support/registryCoverage.ts';

function previousRegistry(
  communities: Array<{ id: string; label: string; members: string[] }>,
): TaxonomyRegistry {
  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const community of communities) {
    for (const page of community.members) assignments[page] = { primaryCommunity: community.id };
  }
  return withCoverage({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 3,
    corpus: 'sha1:abc',
    languages: ['fr'],
    communities: communities.map((community) => ({
      id: community.id,
      prefLabel: { fr: community.label },
      firstSeenRevision: 1,
    })),
    assignments,
  });
}

describe('identifiant de communauté', () => {
  it('est opaque, unique et triable par apparition', () => {
    const early = newCommunityId(1_000);
    const late = newCommunityId(2_000);

    expect(isCommunityId(early)).toBe(true);
    expect(early).not.toBe(newCommunityId(1_000));
    // Deux identifiants se comparent dans leur ordre d'apparition : un diff de
    // registre se lit sans table de correspondance.
    expect(early < late).toBe(true);
  });

  it('ne dérive pas du libellé', () => {
    // C'est tout l'objet du lot : un renommage ne doit pas être une
    // suppression suivie d'une création.
    expect(newCommunityId()).not.toContain('solution');
  });
});

describe('recouvrement de membres', () => {
  it('mesure la continuité, pas l’identité stricte', () => {
    expect(memberOverlap(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(memberOverlap(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBeCloseTo(0.75);
    expect(memberOverlap(['a'], ['b'])).toBe(0);
    // L'ordre n'a aucun sens ici.
    expect(memberOverlap(['b', 'a'], ['a', 'b'])).toBe(1);
  });
});

describe('ré-ancrage des communautés', () => {
  it('alloue partout quand il n’y a pas de registre précédent', () => {
    const anchored = anchorCommunities(
      [{ members: ['a.md', 'b.md'], label: 'Solution' }],
      null,
    );

    expect(anchored[0]!.reanchored).toBe(false);
    expect(isCommunityId(anchored[0]!.id)).toBe(true);
  });

  /*
   Le cas qui justifie tout : une communauté qui gagne une page reste la même
   communauté. Sans ré-ancrage, elle recevrait un nouvel identifiant à chaque
   ingestion et perdrait sa position Canvas et la sélection en cours.
  */
  it('rend son identifiant à une communauté qui a seulement grossi', () => {
    const previous = previousRegistry([
      { id: 'cmty_ancien', label: 'Solution', members: ['a.md', 'b.md', 'c.md'] },
    ]);

    const anchored = anchorCommunities(
      [{ members: ['a.md', 'b.md', 'c.md', 'd.md'], label: 'Solution' }],
      previous,
    );

    expect(anchored[0]!.id).toBe('cmty_ancien');
    expect(anchored[0]!.reanchored).toBe(true);
  });

  it('rend son identifiant même après un renommage complet', () => {
    // Le ré-ancrage regarde les membres, jamais le libellé : c'est ce qui le
    // rend plus robuste qu'un identifiant déterministe dérivé du nom.
    const previous = previousRegistry([
      { id: 'cmty_ancien', label: 'solutions_saas', members: ['a.md', 'b.md'] },
    ]);

    const anchored = anchorCommunities([{ members: ['a.md', 'b.md'], label: 'Solution' }], previous);

    expect(anchored[0]!.id).toBe('cmty_ancien');
  });

  it('traite comme neuve une communauté qui a trop changé', () => {
    const previous = previousRegistry([
      { id: 'cmty_ancien', label: 'Solution', members: ['a.md', 'b.md', 'c.md', 'd.md'] },
    ]);

    const anchored = anchorCommunities([{ members: ['x.md', 'y.md'], label: 'Réseau' }], previous);

    expect(anchored[0]!.reanchored).toBe(false);
  });

  /*
   Une scission ne peut pas produire deux communautés revendiquant la même
   identité : l'ancien identifiant va à la moitié la plus ressemblante, l'autre
   est neuve.
  */
  it('n’attribue un ancien identifiant qu’une seule fois', () => {
    const previous = previousRegistry([
      { id: 'cmty_ancien', label: 'Solution', members: ['a.md', 'b.md', 'c.md', 'd.md'] },
    ]);

    const anchored = anchorCommunities(
      [
        { members: ['a.md', 'b.md', 'c.md'], label: 'Solution' },
        { members: ['d.md'], label: 'Réseau' },
      ],
      previous,
    );

    expect(anchored[0]!.id).toBe('cmty_ancien');
    expect(anchored[1]!.reanchored).toBe(false);
    expect(anchored[1]!.id).not.toBe('cmty_ancien');
  });

  it('donne l’identifiant au meilleur appariement, pas au premier venu', () => {
    const previous = previousRegistry([
      { id: 'cmty_solution', label: 'Solution', members: ['a.md', 'b.md', 'c.md', 'd.md'] },
    ]);

    const anchored = anchorCommunities(
      [
        // Recouvrement 0,5 — au seuil, mais moins bon que le suivant.
        { members: ['a.md', 'b.md'], label: 'Partiel' },
        { members: ['a.md', 'b.md', 'c.md', 'd.md'], label: 'Solution' },
      ],
      previous,
    );

    expect(anchored[1]!.id).toBe('cmty_solution');
    expect(anchored[0]!.reanchored).toBe(false);
  });
});

describe('dépréciation des disparues', () => {
  /*
   Elles ne sont jamais supprimées : c'est ce qui rend la convergence visuelle
   d'une fusion et le remap d'une sélection résolubles indéfiniment.
  */
  it('pointe une communauté fusionnée vers celle qui a repris ses membres', () => {
    const previous = previousRegistry([
      { id: 'cmty_saas', label: 'solutions_saas', members: ['a.md', 'b.md'] },
      { id: 'cmty_board', label: 'board', members: ['c.md'] },
    ]);

    const survivors = anchorCommunities(
      [{ members: ['a.md', 'b.md', 'c.md'], label: 'Solution' }],
      previous,
    );
    const deprecated = deprecateMissing(previous, survivors, 42);

    // cmty_saas a été ré-ancré sur la survivante ; seul cmty_board disparaît.
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]).toMatchObject({
      id: 'cmty_board',
      deprecated: true,
      replacedBy: survivors[0]!.id,
    });
    expect(deprecated[0]!.changeNote?.at(-1)).toMatchObject({ revision: 42, kind: 'merged' });
  });

  it('ne déprécie rien quand tout le monde survit', () => {
    const previous = previousRegistry([
      { id: 'cmty_1', label: 'Solution', members: ['a.md', 'b.md'] },
    ]);
    const survivors = anchorCommunities([{ members: ['a.md', 'b.md'], label: 'Solution' }], previous);

    expect(deprecateMissing(previous, survivors, 42)).toEqual([]);
  });

  it('ne redéprécie pas une entrée déjà dépréciée', () => {
    const previous = previousRegistry([{ id: 'cmty_1', label: 'Solution', members: ['a.md'] }]);
    previous.communities.push({
      id: 'cmty_0',
      prefLabel: { fr: 'Antique' },
      firstSeenRevision: 1,
      deprecated: true,
      replacedBy: 'cmty_1',
    });
    const survivors = anchorCommunities([{ members: ['a.md'], label: 'Solution' }], previous);

    expect(deprecateMissing(previous, survivors, 43)).toEqual([]);
  });
});
