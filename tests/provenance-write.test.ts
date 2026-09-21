import { describe, expect, it } from 'vitest';
import { applyDerivedSources, rewriteSourcesInventory } from '../src/provenance/write.ts';

describe('write-side derivation (lot 3)', () => {
  it('drops a declared source the body never reaches', () => {
    const content = [
      '---',
      'subject: anaplan',
      'type: product',
      'sources:',
      '  - path: raw/ingested/detailed.md',
      '    usage_count: 3',
      '  - path: raw/ingested/other.md',
      '---',
      '',
      '# Anaplan',
      '',
      '## Coûts',
      '',
      'Synthèse.',
      '',
      '[src: raw/ingested/detailed.md#Coûts]',
    ].join('\n');

    const result = applyDerivedSources(content);
    expect(result.clean).toBe(true);
    expect(result.terminal).toEqual(['raw/ingested/detailed.md']);
    expect(result.integrity.missing).toEqual(['raw/ingested/other.md']);

    const rewritten = result.content;
    expect(rewritten).toContain('raw/ingested/detailed.md');
    expect(rewritten).not.toContain('raw/ingested/other.md');
    // The existing record (usage_count) is preserved, not reset.
    expect(rewritten).toContain('usage_count: 3');
  });

  it('follows a source page to the archive it cites', () => {
    const pages = new Map<string, string>([
      ['wiki/sources/detailed-note.md', '# Detailed\n\n## Coûts\n\n[src: raw/ingested/detailed.md#Coûts]\n'],
    ]);
    const content = [
      '---',
      'subject: jedox',
      'type: product',
      'sources: []',
      '---',
      '',
      '# Jedox',
      '',
      '## Coûts',
      '',
      'Synthèse.',
      '',
      '[src: wiki/sources/detailed-note.md#Coûts]',
    ].join('\n');

    const result = applyDerivedSources(content, { resolvePage: (page) => pages.get(page) ?? null });
    expect(result.clean).toBe(true);
    expect(result.terminal).toEqual(['raw/ingested/detailed.md']);
    expect(result.integrity.undeclared).toEqual(['raw/ingested/detailed.md']);
    expect(result.content).toContain('raw/ingested/detailed.md');
  });

  it('keeps the inventory untouched when the closure is not clean', () => {
    const content = [
      '---',
      'subject: x',
      'type: product',
      'sources:',
      '  - path: raw/ingested/detailed.md',
      '---',
      '',
      '# X',
      '',
      '[src: wiki/sources/missing.md]',
    ].join('\n');

    const result = applyDerivedSources(content);
    expect(result.clean).toBe(false);
    expect(result.unresolved).toEqual(['wiki/sources/missing.md']);
    // The page is returned unchanged: a broken chain never drops a source.
    expect(result.content).toBe(content);
  });

  it('removes the key entirely when the body reaches no proof', () => {
    const content = ['---', 'subject: empty', 'sources:', '  - path: raw/ingested/a.md', '---', '', '# Empty', ''].join('\n');
    const rewritten = rewriteSourcesInventory(content, []);
    expect(rewritten).not.toContain('sources:');
  });
});
