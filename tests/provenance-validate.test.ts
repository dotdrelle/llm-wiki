import { describe, expect, it } from 'vitest';
import { validateAnchoredCitations } from '../src/provenance/validate.ts';

const DOCS = new Map<string, string>([
  ['raw/ingested/x.md', '# X\n\n## Coûts\n\n90 k€.\n\n## Coûts\n\n120 k€.\n'],
  ['raw/ingested/ok.md', '# OK\n\n## Coûts\n\n12 k€.\n'],
]);
const load = (documentPath: string): string | null => DOCS.get(documentPath) ?? null;

describe('anchored citation validation (lot 1/5)', () => {
  it('accepts an anchored citation that resolves uniquely', () => {
    expect(validateAnchoredCitations('[src: raw/ingested/ok.md#Coûts]', load)).toEqual([]);
  });

  it('flags an unanchored citation as a degradation', () => {
    const issues = validateAnchoredCitations('[src: raw/ingested/ok.md]', load);
    expect(issues.map((issue) => issue.code)).toEqual(['unanchored']);
  });

  it('rejects a missing document even without an anchor', () => {
    expect(validateAnchoredCitations('[src: raw/ingested/gone.md]', load).map((i) => i.code)).toEqual(['missing']);
  });

  it('flags an ambiguous anchor', () => {
    const issues = validateAnchoredCitations('[src: raw/ingested/x.md#Coûts]', load);
    expect(issues.map((issue) => issue.code)).toEqual(['ambiguous']);
  });

  it('flags an anchor that matches nothing and an unreadable document', () => {
    expect(validateAnchoredCitations('[src: raw/ingested/ok.md#Absent]', load).map((i) => i.code)).toEqual(['missing']);
    expect(validateAnchoredCitations('[src: raw/ingested/gone.md#Coûts]', load).map((i) => i.code)).toEqual(['missing']);
  });
});
