import { describe, expect, it } from 'vitest';
import { anchorTagFamilies, missingTagAssignments, parseTagFamilies, parseTagFamilyLabels, restrictTagFamilies } from '../src/ingest/tagFamilies.ts';

describe('TAXO tag families', () => {
  it('accepts complete assignments and canonicalizes tag spelling from the input', () => {
    expect(parseTagFamilies(
      '[{"family":"Réseau","tags":["VLAN","VPN"]}]',
      ['vlan', 'vpn'],
    )).toEqual([{ family: 'Réseau', tags: ['vlan', 'vpn'] }]);
  });

  it('keeps a partial response instead of discarding the whole grouping', () => {
    expect(parseTagFamilies('[{"family":"A","tags":["a"]}]', ['a', 'b']))
      .toEqual([{ family: 'A', tags: ['a'] }]);
    expect(missingTagAssignments([{ family: 'A', tags: ['a'] }], ['a', 'b'])).toEqual(['b']);
  });

  it('ignores a repeated tag and refuses a response that assigns nothing valid', () => {
    expect(parseTagFamilies('[{"family":"A","tags":["a","a"]}]', ['a']))
      .toEqual([{ family: 'A', tags: ['a'] }]);
    expect(parseTagFamilies('[{"family":"A","tags":["other"]}]', ['a'])).toBeNull();
    expect(parseTagFamilies('not json', ['a'])).toBeNull();
  });

  it('keeps established family labels while adding new families', () => {
    const proposed = [
      { family: 'RESEAU', tags: ['vpn'] },
      { family: 'Sécurité', tags: ['chiffrement'] },
    ];
    expect(anchorTagFamilies(proposed, [{ family: 'Réseau', tags: ['vlan'] }])).toEqual([
      { family: 'Réseau', tags: ['vlan', 'vpn'] },
      { family: 'Sécurité', tags: ['chiffrement'] },
    ]);
  });

  it('parses a bounded workspace family catalogue and canonicalizes chunk assignments', () => {
    expect(parseTagFamilyLabels('["Operations", "Sécurité", "OPERATIONS"]', 2, 4))
      .toEqual(['Operations', 'Sécurité']);
    expect(parseTagFamilyLabels('["Operations"]', 2, 4)).toBeNull();
    expect(restrictTagFamilies([
      { family: 'OPERATIONS', tags: ['ingest'] },
      { family: 'Invented', tags: ['unknown'] },
      { family: 'Sécurité', tags: ['access'] },
    ], ['Operations', 'Sécurité'])).toEqual([
      { family: 'Operations', tags: ['ingest'] },
      { family: 'Sécurité', tags: ['access'] },
    ]);
  });
});
