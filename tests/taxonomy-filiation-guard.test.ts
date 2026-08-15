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
      expect(result.issues[0]).toContain('unfiled deprecation 67% beyond the ceiling 30%');
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
      community('b', { prefLabel: { fr: 'renamed' } }), // label changed
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

describe('stable survivor selection (6.3)', () => {
  it('returns null on an empty list', () => {
    expect(pickSurvivor([])).toBeNull();
  });

  it('keeps the oldest community', () => {
    const old = community('x', { firstSeenRevision: 1 });
    const recent = community('y', { firstSeenRevision: 4 });
    expect(pickSurvivor([recent, old])).toBe('x');
  });

  it('breaks ties at equal age by lexicographic id', () => {
    const z = community('z', { firstSeenRevision: 2 });
    const a = community('a', { firstSeenRevision: 2 });
    const m = community('m', { firstSeenRevision: 2 });
    expect(pickSurvivor([z, a, m])).toBe('a');
  });

  it('stays deterministic whatever the list order at equal age', () => {
    const a = community('a', { firstSeenRevision: 1 });
    const b = community('b', { firstSeenRevision: 1 });
    expect(pickSurvivor([b, a])).toBe('a');
    expect(pickSurvivor([a, b])).toBe('a');
  });

  it('ignores label and position: only age then id count', () => {
    const attractive = community('n', {
      firstSeenRevision: 5,

      prefLabel: { fr: 'Security' },
    });
    const older = community('k', { firstSeenRevision: 1, prefLabel: { fr: 'page' } });
    expect(pickSurvivor([attractive, older])).toBe('k');
  });
});

describe('writing a deprecated stub (6.3)', () => {
  it('deprecates the absorbed community and records the absorption on the survivor', () => {
    const before = [community('a'), community('b')];
    const next = deprecateInto(before, { id: 'b', replacedBy: 'a', revision: 2 });
    const survivor = next.find((c) => c.id === 'a')!;
    const absorbing = next.find((c) => c.id === 'b')!;
    expect(absorbing.deprecated).toBe(true);
    expect(absorbing.replacedBy).toBe('a');
    expect(absorbing.changeNote?.at(-1)?.kind).toBe('deprecated');
    expect(survivor.replaces).toContain('b');
    // a stays live and b is no longer a read target.
    expect(survivor.deprecated ?? false).toBe(false);
  });

  it('is idempotent: never duplicates replaces', () => {
    const once = deprecateInto([community('a'), community('b')], {
      id: 'b',
      replacedBy: 'a',
      revision: 1,
    });
    const twice = deprecateInto(once, { id: 'b', replacedBy: 'a', revision: 1 });
    const survivor = twice.find((c) => c.id === 'a')!;
    expect(survivor.replaces!.filter((id) => id === 'b')).toHaveLength(1);
  });

  it('refuses to deprecate toward the community itself', () => {
    const next = deprecateInto([community('a')], {
      id: 'a',
      replacedBy: 'a',
      revision: 1,
    });
    expect(next.find((c) => c.id === 'a')!.deprecated ?? false).toBe(false);
  });

  it('refuses a target absent from the current registry', () => {
    const next = deprecateInto([community('a')], {
      id: 'a',
      replacedBy: 'ghost',
      revision: 1,
    });
    expect(next.find((c) => c.id === 'a')!.deprecated ?? false).toBe(false);
  });

  it('refuses an already deprecated target', () => {
    const next = deprecateInto(
      [community('a'), community('b', { deprecated: true, replacedBy: 'a' })],
      { id: 'c', replacedBy: 'b', revision: 1 },
    );
    expect(next.find((c) => c.id === 'c')).toBeUndefined();
  });
});

describe('before/after report by category (6.3)', () => {
  // A complete current registry (communities + assignments).
  const currentRegistry = (
    communities: RegistryCommunity[],
    assignments: TaxonomyRegistry['assignments'] = {},
  ): TaxonomyRegistry => ({ ...registry(communities), assignments });

  it('classifies a page merge as merged and not as lost', () => {
    // a held pages p1 p2; the revision moves them all into b.
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

  it('detects a split of two new branches out of a single source', () => {
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
        // a disappears; its pages split between x and y, both new.
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

  it('classifies a plain creation, not to be confused with a split', () => {
    const prev = registry([community('a')]);
    const current = currentRegistry([
      community('a'),
      community('n', { firstSeenRevision: 2 }),
    ]);
    const summary = summarizeLineage(prev, current);
    expect(summary.created).toContain('n');
    expect(summary.split).toEqual([]);
  });

  it('classifies unchanged and renamed by label', () => {
    const prev = registry([community('a'), community('b')]);
    const current = currentRegistry([
      community('a'),
      community('b', { prefLabel: { fr: 'renamed' } }),
    ]);
    const summary = summarizeLineage(prev, current);
    expect(summary.unchanged).toContain('a');
    expect(summary.renamed).toContain('b');
  });

  it('classifies a disappearance with no pages nor successor as a real loss', () => {
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
