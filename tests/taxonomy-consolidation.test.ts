import { describe, expect, it } from 'vitest';
import {
  consolidate,
  RENAME_MIN_REVISION_GAP,
  RENAME_MIN_STABILITY,
} from '../src/graph/wiki/taxonomy/consolidation.ts';
import type { AnchoredCommunity } from '../src/graph/wiki/taxonomy/identity.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';

function previous(
  communities: Array<{
    id: string;
    label: string;
    members: string[];
    firstSeenRevision?: number;
    renamedAt?: number;
    prefLabel?: Record<string, string>;
  }>,
): TaxonomyRegistry {
  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const community of communities) {
    for (const page of community.members) assignments[page] = { primaryCommunity: community.id };
  }
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 10,
    corpus: 'sha1:abc',
    languages: ['fr'],
    communities: communities.map((community) => ({
      id: community.id,
      prefLabel: community.prefLabel ?? { fr: community.label },
      firstSeenRevision: community.firstSeenRevision ?? 1,
      ...(community.renamedAt
        ? { changeNote: [{ revision: community.renamedAt, kind: 'renamed' }] }
        : {}),
    })),
    assignments,
  };
}

const draft = (id: string, label: string, members: string[]): AnchoredCommunity => ({
  id,
  label,
  members,
  reanchored: true,
});

const ok = (result: ReturnType<typeof consolidate>) => {
  if (!result.ok) throw new Error(`conflits inattendus : ${JSON.stringify(result.conflicts)}`);
  return result;
};

describe('hystérésis sur les renommages', () => {
  it('donne son nom à une communauté inédite, sans rien stabiliser', () => {
    // Il n'y a pas de « nom précédent » à protéger : l'hystérésis n'a pas
    // d'objet, et l'appliquer laisserait la bulle sans nom.
    const result = ok(consolidate([draft('cmty_new', 'Solution', ['a.md'])], null, {
      language: 'fr',
      revision: 5,
    }));

    expect(result.decisions[0]).toMatchObject({ outcome: 'created', label: 'Solution' });
    expect(result.communities[0]).toMatchObject({
      prefLabel: { fr: 'Solution' },
      firstSeenRevision: 5,
    });
  });

  it('ne fait rien quand le nom proposé est déjà le nom courant', () => {
    const before = previous([{ id: 'cmty_1', label: 'Solution', members: ['a.md'] }]);
    const result = ok(consolidate([draft('cmty_1', 'solution', ['a.md'])], before, {
      language: 'fr',
      revision: 20,
    }));

    // La comparaison est normalisée : « solution » n'est pas un renommage.
    expect(result.decisions[0]!.outcome).toBe('unchanged');
    expect(result.communities[0]!.prefLabel.fr).toBe('Solution');
  });

  it('accepte un renommage stable et suffisamment espacé', () => {
    const before = previous([
      { id: 'cmty_1', label: 'solutions', members: ['a.md', 'b.md', 'c.md'], renamedAt: 1 },
    ]);
    const result = ok(consolidate(
      [draft('cmty_1', 'Solution', ['a.md', 'b.md', 'c.md'])],
      before,
      { language: 'fr', revision: 1 + RENAME_MIN_REVISION_GAP },
    ));

    expect(result.decisions[0]).toMatchObject({ outcome: 'renamed', label: 'Solution' });
    // L'ancien nom devient consultable et cherchable plutôt que perdu.
    expect(result.communities[0]!.altLabel?.fr).toContain('solutions');
    expect(result.communities[0]!.changeNote?.at(-1)).toMatchObject({ kind: 'renamed' });
  });

  /*
   Le cœur de D6 : sans écart minimal, deux propositions successives font
   osciller un nom d'une révision à l'autre et l'utilisateur perd son modèle
   mental de la carte.
  */
  it('refuse un renommage trop rapproché du précédent', () => {
    const before = previous([
      { id: 'cmty_1', label: 'Solution', members: ['a.md', 'b.md'], renamedAt: 9 },
    ]);
    const result = ok(consolidate([draft('cmty_1', 'Offre', ['a.md', 'b.md'])], before, {
      language: 'fr',
      revision: 10,
    }));

    expect(result.decisions[0]).toMatchObject({ outcome: 'kept', proposed: 'Offre' });
    expect(result.communities[0]!.prefLabel.fr).toBe('Solution');
    // La proposition n'est pas jetée : la prochaine consolidation la retrouve.
    expect(result.communities[0]!.altLabel?.fr).toContain('Offre');
  });

  it('refuse un renommage d’une communauté qui a trop changé', () => {
    const before = previous([
      { id: 'cmty_1', label: 'Solution', members: ['a.md', 'b.md', 'c.md', 'd.md'] },
    ]);
    const result = ok(consolidate([draft('cmty_1', 'Réseau', ['a.md', 'x.md'])], before, {
      language: 'fr',
      revision: 30,
    }));

    const decision = result.decisions[0]!;
    expect(decision.outcome).toBe('kept');
    expect(decision.stability!).toBeLessThan(RENAME_MIN_STABILITY);
  });

  it('lève l’hystérésis sur une consolidation forcée, jamais l’unicité', () => {
    const before = previous([
      { id: 'cmty_1', label: 'Solution', members: ['a.md', 'b.md'], renamedAt: 10 },
    ]);
    const result = ok(consolidate([draft('cmty_1', 'Offre', ['a.md', 'b.md'])], before, {
      language: 'fr',
      revision: 11,
      force: true,
    }));

    expect(result.decisions[0]!.outcome).toBe('renamed');
  });

  /*
   Une langue absente n'est pas un renommage, c'est une traduction. Lui
   appliquer l'hystérésis interdirait d'ajouter une langue : le repli resterait
   affiché pour toujours.
  */
  it('ajoute une langue sans la soumettre à l’hystérésis', () => {
    const before = previous([
      { id: 'cmty_1', label: 'Solution', members: ['a.md'], renamedAt: 10, prefLabel: { fr: 'Solution' } },
    ]);
    const result = ok(consolidate([draft('cmty_1', 'Solution', ['a.md'])], before, {
      language: 'en',
      revision: 11,
    }));

    expect(result.communities[0]!.prefLabel).toEqual({ fr: 'Solution', en: 'Solution' });
  });
});

describe('unicité des libellés visibles', () => {
  it('rejette deux communautés actives portant le même nom', () => {
    const result = consolidate(
      [draft('cmty_1', 'Solution', ['a.md']), draft('cmty_2', 'solution', ['b.md'])],
      null,
      { language: 'fr', revision: 5 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts).toEqual([{ label: 'solution', ids: ['cmty_1', 'cmty_2'] }]);
  });

  /*
   L'ordre compte : l'hystérésis peut CONSERVER un ancien nom et recréer une
   collision que la proposition n'avait pas. Vérifier l'unicité avant
   validerait un état qui ne sera jamais celui du registre.
  */
  it('détecte une collision créée par l’hystérésis elle-même', () => {
    const before = previous([
      // Renommée trop récemment : « Offre » sera refusé, « Solution » conservé.
      { id: 'cmty_1', label: 'Solution', members: ['a.md', 'b.md'], renamedAt: 10 },
      { id: 'cmty_2', label: 'Réseau', members: ['c.md', 'd.md'] },
    ]);

    const result = consolidate(
      [
        draft('cmty_1', 'Offre', ['a.md', 'b.md']),
        // La proposition, elle, ne collisionnait pas : Offre + Solution.
        draft('cmty_2', 'Solution', ['c.md', 'd.md']),
      ],
      before,
      { language: 'fr', revision: 11 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflicts[0]!.ids).toEqual(['cmty_1', 'cmty_2']);
  });

  it('n’invente jamais de suffixe pour lever un conflit', () => {
    const result = consolidate(
      [draft('cmty_1', 'Solution', ['a.md']), draft('cmty_2', 'Solution', ['b.md'])],
      null,
      { language: 'fr', revision: 5 },
    );

    expect(JSON.stringify(result)).not.toContain('Solution-2');
    expect(JSON.stringify(result)).not.toContain('Solution 2');
  });

  it('tolère le même libellé dans deux langues', () => {
    const result = consolidate(
      [draft('cmty_1', 'Solution', ['a.md']), draft('cmty_2', 'Réseau', ['b.md'])],
      null,
      { language: 'fr', revision: 5 },
    );

    expect(result.ok).toBe(true);
  });
});
