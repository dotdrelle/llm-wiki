import { describe, expect, it } from 'vitest';
import {
  deprecateInto,
  guardAgainstMassDisruption,
  lineageReport,
  pickSurvivor,
  summarizeLineage,
  type LineageReport,
} from '../src/graph/wiki/taxonomy/filiation.ts';
import {
  type RegistryCommunity,
  type TaxonomyRegistry,
} from '../src/graph/wiki/taxonomy/schema.ts';

/*
 Garde-fou de dépréciation massive (plan Lot 3, §6.3).

 Le socle déprécie déjà les communautés disparues en les pointant vers un
 successeur quand il y en a un. Ce qui manquait, et que ce module teste, c'est
 la borne sur la DISPARITION NON FILIÉE : une révision peut réorganiser la
 carte en absorbant, mais elle ne peut pas creuser une part trop grande de
 trous — des communautés actives évanouies sans remplaçante — sans fournir une
 filiation explicite. Et `force` ne contourne pas cette promesse.
*/

const community = (
  id: string,
  extra: Partial<RegistryCommunity> = {},
): RegistryCommunity => ({
  id,
  prefLabel: { fr: id },
  firstSeenRevision: 1,
  ...extra,
});

const registry = (communities: RegistryCommunity[]): TaxonomyRegistry => ({
  schemaVersion: 3,
  revision: 1,
  corpus: 'fp:test',
  corpusAlgorithm: 'sha256',
  languages: ['fr'],
  communities,
  assignments: {},
  corpusPageIds: [],
  sampledPageIds: [],
});

describe('garde-fou contre la dépréciation massive', () => {
  it('laisse passer une révision sans aucune dépréciation', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    const current = [community('a'), community('b'), community('c')];
    expect(guardAgainstMassDisruption(prev, current)).toEqual({ ok: true });
  });

  it('laisse passer une fusion où chaque disparue pointe une remplaçante vivante', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    // b et c sont absorbées dans a : toutes filiées, aucun trou.
    const current = [
      community('a'),
      community('b', { deprecated: true, replacedBy: 'a' }),
      community('c', { deprecated: true, replacedBy: 'a' }),
    ];
    expect(guardAgainstMassDisruption(prev, current)).toEqual({ ok: true });
  });

  it('rejette quand plus que la borne de communautés actives deviennent des trous', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    // b et c disparaissent SANS successeur : 2/3 actives perdues, au-dessus de 0.3.
    const current = [community('a')];
    const result = guardAgainstMassDisruption(prev, current);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toContain('dépréciation non filiée 67 %');
      expect(result.issues.join(' ')).toContain('b');
      expect(result.issues.join(' ')).toContain('c');
    }
  });

  it('rejette même sous une dépréciation globalement sous le plafond si les pertes sans filiation dépassent la borne', () => {
    // 8 actives, 3 perdues sans successeur : 37.5 % > 0.3 -> rejet.
    const prev = registry([
      community('a'),
      community('b'),
      community('c'),
      community('d'),
      community('e'),
      community('f'),
      community('g'),
      community('h'),
    ]);
    const current = [
      community('a'),
      community('b'),
      community('c'),
      community('d'),
      community('e'),
    ];
    const result = guardAgainstMassDisruption(prev, current, { maxUnfiledRate: 0.3 });
    expect(result.ok).toBe(false);
  });

  it('force ne contourne pas le garde-fou', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    const current = [community('a')];
    // Pas de paramètre force dans la commande : elle n'en a PAS besoin. Ce test
    // verrouille qu'il n'existe pas de porte latérale qui lèverait la borne.
    const result = guardAgainstMassDisruption(prev, current);
    expect(result.ok).toBe(false);
  });

  it('résout une chaîne de dépréciations vers une vivante (a -> b -> c vivante)', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    const current = [
      community('a', { deprecated: true, replacedBy: 'b' }),
      community('b', { deprecated: true, replacedBy: 'c' }),
      community('c'),
    ];
    // a et b sont filiées (chainées vers c) : aucun trou.
    expect(guardAgainstMassDisruption(prev, current)).toEqual({ ok: true });
  });

  it('compte une dépréciation dont la cible est elle-même morte comme un trou', () => {
    const prev = registry([community('a'), community('b')]);
    const current = [
      community('a', { deprecated: true, replacedBy: 'b' }),
      community('b', { deprecated: true, replacedBy: null }),
    ];
    const result = guardAgainstMassDisruption(prev, current);
    expect(result.ok).toBe(false); // a et b (2/2 actives) deviennent des trous.
  });

  it('accepte une borne personnalisée plus généreuse', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    const current = [community('a')];
    expect(guardAgainstMassDisruption(prev, current, { maxUnfiledRate: 0.7 }).ok).toBe(
      true,
    );
  });
});

describe('rapport de filiation', () => {
  it('renvoie des entrées vides sans registre précédent', () => {
    const report = lineageReport(null, [community('x')]);
    expect(report.entries).toEqual([]);
    expect(report.trulyLost).toEqual([]);
  });

  it('classe unchanged vs rename selon le libellé', () => {
    const prev = registry([community('a'), community('b')]);
    const current = [
      community('a'), // même libellé
      community('b', { prefLabel: { fr: 'renommée' } }), // libellé changé
    ];
    const report = lineageReport(prev, current);
    const byId = new Map(
      (report.entries as Array<{ id: string; op: string }>).map((e) => [e.id, e.op]),
    );
    expect(byId.get('a')).toBe('unchanged');
    expect(byId.get('b')).toBe('rename');
  });

  it('classe une absorption filiée en merge et une évanouie en perte réelle', () => {
    const prev = registry([community('a'), community('b'), community('c')]);
    const current = [
      community('a'),
      community('b', { deprecated: true, replacedBy: 'a' }),
      // c n'apparaît pas : véritable trou.
    ];
    const report = lineageReport(prev, current) as LineageReport;
    const entries = report.entries as Array<{ id: string; op: string; into?: string }>;
    const b = entries.find((e) => e.id === 'b')!;
    expect(b.op).toBe('merge');
    expect(b.into).toBe('a');
    expect(report.trulyLost).toContain('c');
  });
});

describe('règle stable de choix du survivant (6.3)', () => {
  it('renvoie null sur une liste vide', () => {
    expect(pickSurvivor([])).toBeNull();
  });

  it('garde la communauté la plus ancienne', () => {
    const old = community('x', { firstSeenRevision: 1 });
    const recent = community('y', { firstSeenRevision: 4 });
    expect(pickSurvivor([recent, old])).toBe('x');
  });

  it('départage à âges égaux par identifiant lexicographique', () => {
    const z = community('z', { firstSeenRevision: 2 });
    const a = community('a', { firstSeenRevision: 2 });
    const m = community('m', { firstSeenRevision: 2 });
    expect(pickSurvivor([z, a, m])).toBe('a');
  });

  it('reste déterministe quel que soit l’ordre de la liste à âges égaux', () => {
    const a = community('a', { firstSeenRevision: 1 });
    const b = community('b', { firstSeenRevision: 1 });
    expect(pickSurvivor([b, a])).toBe('a');
    expect(pickSurvivor([a, b])).toBe('a');
  });

  it('ignore le libellé et la position : seul l’âge puis l’id comptent', () => {
    const attractive = community('n', {
      firstSeenRevision: 5,
      prefLabel: { fr: 'Sécurité' },
    });
    const older = community('k', { firstSeenRevision: 1, prefLabel: { fr: 'page' } });
    expect(pickSurvivor([attractive, older])).toBe('k');
  });
});

describe('rédaction d’une souche dépréciée (6.3)', () => {
  it('déprécie l’absorbée et enregistre l’absorption côté survivant', () => {
    const before = [community('a'), community('b')];
    const next = deprecateInto(before, { id: 'b', replacedBy: 'a', revision: 2 });
    const survivor = next.find((c) => c.id === 'a')!;
    const absorbing = next.find((c) => c.id === 'b')!;
    expect(absorbing.deprecated).toBe(true);
    expect(absorbing.replacedBy).toBe('a');
    expect(absorbing.changeNote?.at(-1)?.kind).toBe('deprecated');
    expect(survivor.replaces).toContain('b');
    // a reste vivante et b n'est plus là comme cible de lecture.
    expect(survivor.deprecated ?? false).toBe(false);
  });

  it('est idempotent : ne duplique jamais replaces', () => {
    const once = deprecateInto([community('a'), community('b')], {
      id: 'b',
      replacedBy: 'a',
      revision: 1,
    });
    const twice = deprecateInto(once, { id: 'b', replacedBy: 'a', revision: 1 });
    const survivor = twice.find((c) => c.id === 'a')!;
    expect(survivor.replaces!.filter((id) => id === 'b')).toHaveLength(1);
  });

  it('refuse de déprécier vers une communauté elle-même', () => {
    const next = deprecateInto([community('a')], {
      id: 'a',
      replacedBy: 'a',
      revision: 1,
    });
    expect(next.find((c) => c.id === 'a')!.deprecated ?? false).toBe(false);
  });

  it('refuse une cible absente du registre courant', () => {
    const next = deprecateInto([community('a')], {
      id: 'a',
      replacedBy: 'ghost',
      revision: 1,
    });
    expect(next.find((c) => c.id === 'a')!.deprecated ?? false).toBe(false);
  });

  it('refuse une cible déjà dépréciée', () => {
    const next = deprecateInto(
      [community('a'), community('b', { deprecated: true, replacedBy: 'a' })],
      { id: 'c', replacedBy: 'b', revision: 1 },
    );
    expect(next.find((c) => c.id === 'c')).toBeUndefined();
  });
});

describe('rapport avant/après en catégories (6.3)', () => {
  // Un registre courant complet (communautés + assignations).
  const currentRegistry = (
    communities: RegistryCommunity[],
    assignments: TaxonomyRegistry['assignments'] = {},
  ): TaxonomyRegistry => ({ ...registry(communities), assignments });

  it('classe une fusion de pages en merged et non en perte', () => {
    // a avait les pages p1 p2 ; la révision les déplace toutes dans b.
    const prev: TaxonomyRegistry = {
      ...registry([
        community('a', { firstSeenRevision: 1 }),
        community('b', { firstSeenRevision: 1 }),
      ]),
      assignments: { p1: { primaryCommunity: 'a' }, p2: { primaryCommunity: 'a' } },
    };
    const current: TaxonomyRegistry = currentRegistry(
      [
        community('b', { firstSeenRevision: 1, replaces: ['a'] }),
        community('a', { firstSeenRevision: 1, deprecated: true, replacedBy: 'b' }),
      ],
      { p1: { primaryCommunity: 'b' }, p2: { primaryCommunity: 'b' } },
    );
    const summary = summarizeLineage(prev, current);
    expect(summary.merged).toContainEqual({ id: 'a', into: 'b' });
    expect(summary.trulyLost).not.toContain('a');
  });

  it('détecte une scission de deux branches nouvelles issues d’une seule source', () => {
    const prev: TaxonomyRegistry = {
      ...registry([community('a', { firstSeenRevision: 1 })]),
      assignments: {
        p1: { primaryCommunity: 'a' },
        p2: { primaryCommunity: 'a' },
        p3: { primaryCommunity: 'a' },
      },
    };
    const current: TaxonomyRegistry = currentRegistry(
      [
        // a disparaît ; ses pages se répartissent entre x et y, toutes nouvelles.
        community('x', { firstSeenRevision: 2 }),
        community('y', { firstSeenRevision: 2 }),
      ],
      {
        p1: { primaryCommunity: 'x' },
        p2: { primaryCommunity: 'y' },
        p3: { primaryCommunity: 'x' },
      },
    );
    const summary = summarizeLineage(prev, current);
    expect(summary.split).toContainEqual({ from: 'a', branches: ['x', 'y'] });
    expect(summary.merged).toEqual([]);
    expect(summary.created).not.toContain('x');
    expect(summary.created).not.toContain('y');
  });

  it('classe une création simple, sans la confondre avec une scission', () => {
    const prev = registry([community('a')]);
    const current = currentRegistry([
      community('a'),
      community('n', { firstSeenRevision: 2 }),
    ]);
    const summary = summarizeLineage(prev, current);
    expect(summary.created).toContain('n');
    expect(summary.split).toEqual([]);
  });

  it('classe unchanged et renamed selon le libellé', () => {
    const prev = registry([community('a'), community('b')]);
    const current = currentRegistry([
      community('a'),
      community('b', { prefLabel: { fr: 'renommée' } }),
    ]);
    const summary = summarizeLineage(prev, current);
    expect(summary.unchanged).toContain('a');
    expect(summary.renamed).toContain('b');
  });

  it('classe une disparition sans pages ni successeur en perte réelle', () => {
    const prev: TaxonomyRegistry = {
      ...registry([community('a'), community('b')]),
      assignments: { p1: { primaryCommunity: 'a' } },
    };
    const current: TaxonomyRegistry = currentRegistry([community('b')]);
    const summary = summarizeLineage(prev, current);
    expect(summary.trulyLost).toContain('a');
    expect(summary.deprecated).toContainEqual({ id: 'a', into: null });
  });
});
