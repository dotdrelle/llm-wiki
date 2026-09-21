import { describe, expect, it } from 'vitest';
import { deriveTerminalSources, validateSourcesIntegrity } from '../src/provenance/derive.ts';

describe('derive sources (lot 3)', () => {
  it('follows a leaf to its terminal archives through the source pages', () => {
    const pages = new Map<string, string>([
      ['wiki/sources/a.md', '# A\n\n[src: raw/ingested/detailed.md#Coûts]\n'],
    ]);
    const content = '# Leaf\n\n[src: wiki/sources/a.md#A]\n[src: raw/ingested/direct.md]\n';

    const result = deriveTerminalSources({ content, resolvePage: (page) => pages.get(page) ?? null });

    expect(result.terminal).toEqual(['raw/ingested/detailed.md', 'raw/ingested/direct.md']);
    expect(result.unresolved).toEqual([]);
    expect(result.depthExceeded).toBe(false);
  });

  it('reports a cited page that cannot be read', () => {
    const result = deriveTerminalSources({ content: '# L\n\n[src: wiki/sources/missing.md]\n' });
    expect(result.terminal).toEqual([]);
    expect(result.unresolved).toEqual(['wiki/sources/missing.md']);
  });

  it('detects a citation cycle once, in canonical order', () => {
    const pages = new Map<string, string>([
      ['wiki/concepts/demo/a.md', '[src: wiki/concepts/demo/b.md]\n'],
      ['wiki/concepts/demo/b.md', '[src: wiki/concepts/demo/a.md]\n'],
    ]);
    const result = deriveTerminalSources({
      content: pages.get('wiki/concepts/demo/a.md')!,
      resolvePage: (page) => pages.get(page) ?? null,
    });
    expect(result.cycles.length).toBe(1);
    expect(result.cycles[0]).toEqual(['wiki/concepts/demo/a.md', 'wiki/concepts/demo/b.md']);
  });

  it('flags declared entries never reached and reached entries never declared', () => {
    const integrity = validateSourcesIntegrity(
      ['raw/ingested/detailed.md', 'raw/ingested/other.md'],
      ['raw/ingested/detailed.md', 'raw/ingested/direct.md'],
    );
    expect(integrity.missing).toEqual(['raw/ingested/other.md']);
    expect(integrity.undeclared).toEqual(['raw/ingested/direct.md']);
  });
});
