import { describe, expect, it } from 'vitest';
import { normalizeConceptFolderName } from '../src/ingest/conceptFolders.ts';

describe('normalizeConceptFolderName', () => {
  it('normalizes Unicode labels without transliterating them', () => {
    expect(normalizeConceptFolderName('Produit Écrit')).toBe('produit-écrit');
    expect(normalizeConceptFolderName('  Solution / Logicielle ')).toBe('solution-logicielle');
  });

  it('rejects an empty or oversized name rather than writing it', () => {
    expect(normalizeConceptFolderName('   ')).toBeNull();
    expect(normalizeConceptFolderName('a'.repeat(60))).toBeNull();
  });
});
