import { describe, expect, it } from 'vitest';
import {
  MAX_UNFILED_DEPRECATION_RATE,
  guardAgainstMassDisruption,
  lineageReport,
  type LineageReport,
} from '../src/graph/wiki/taxonomy/filiation.ts';
import { type RegistryCommunity, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';

/*
 Garde-fou de dépréciation massive (plan Lot 3, §6.3).

 Le socle déprécie déjà les communautés disparues en les pointant vers un
 successeur quand il y en a un. Ce qui manquait, et que ce module teste, c'est
 la borne sur la DISPARITION NON FILIÉE : une révision peut réorganiser la
 carte en absorbant, mais elle ne peut pas creuser une part trop grande de
 trous — des communautés actives évanouies sans remplaçante — sans fournir une
 filiation explicite. Et `force` ne contourne pas cette promesse.
*/

const community = (id: string, extra: Partial<RegistryCommunity> = {}): RegistryCommunity => ({
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
      community('a'), community('b'), community('c'),
      community('d'), community('e'), community('f'),
      community('g'), community('h'),
    ]);
    const current = [community('a'), community('b'), community('c'), community('d'), community('e')];
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
    expect(guardAgainstMassDisruption(prev, current, { maxUnfiledRate: 0.7 }).ok).toBe(true);
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
    const byId = new Map((report.entries as Array<{ id: string; op: string }>).map((e) => [e.id, e.op]));
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
