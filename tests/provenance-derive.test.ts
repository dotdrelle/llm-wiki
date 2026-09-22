import { describe, expect, it } from 'vitest';
import { deriveTerminalSources, detectSourceLoss, validateSourcesIntegrity } from '../src/provenance/derive.ts';

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

  it('follows only the cited SECTION of an intermediate page', () => {
    const pages = new Map<string, string>([
      [
        'wiki/sources/a.md',
        '# A\n\n## Coût\n\n[src: raw/ingested/cost.md#Coût]\n\n## Risque\n\n[src: raw/ingested/risk.md#Risque]\n',
      ],
    ]);
    const resolvePage = (page: string): string | null => pages.get(page) ?? null;

    const cost = deriveTerminalSources({ content: '# L\n\n[src: wiki/sources/a.md#Coût]\n', resolvePage });
    expect(cost.terminal).toEqual(['raw/ingested/cost.md']);
    expect(cost.fragments).toEqual([{ path: 'raw/ingested/cost.md', anchor: 'Coût' }]);

    const risk = deriveTerminalSources({ content: '# L\n\n[src: wiki/sources/a.md#Risque]\n', resolvePage });
    expect(risk.terminal).toEqual(['raw/ingested/risk.md']);

    // Changing the cited section is a real change of proof.
    expect(detectSourceLoss('# L\n\n[src: wiki/sources/a.md#Coût]\n', '# L\n\n[src: wiki/sources/a.md#Risque]\n', { resolvePage }))
      .toEqual([{ path: 'raw/ingested/cost.md', anchor: 'Coût' }]);
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

describe('detectSourceLoss (deterministic multi-source guard)', () => {
  it('reports a terminal proof the candidate no longer reaches', () => {
    const previous = '# Leaf\n\nA. [src: raw/ingested/a.md#Coûts]\nB. [src: raw/ingested/b.md#Garanties]\n';
    const candidate = '# Leaf\n\nA. [src: raw/ingested/a.md#Coûts]\nB. rien.\n';
    expect(detectSourceLoss(previous, candidate)).toEqual([
      { path: 'raw/ingested/b.md', anchor: 'Garanties' },
    ]);
  });

  it('is empty when the candidate keeps every earlier proof, even re-ordered', () => {
    const previous = '# Leaf\n\nA. [src: raw/ingested/a.md#Coûts]\nB. [src: raw/ingested/b.md#Garanties]\n';
    const candidate = '# Leaf\n\nB. [src: raw/ingested/b.md#Garanties]\nA. [src: raw/ingested/a.md#Coûts]\n';
    expect(detectSourceLoss(previous, candidate)).toEqual([]);
  });

  it('distinguishes the loss of one SECTION of a still-cited file', () => {
    const previous = '# Leaf\n\n[src: raw/ingested/a.md#Coûts]\n[src: raw/ingested/a.md#Garanties]\n';
    const candidate = '# Leaf\n\n[src: raw/ingested/a.md#Coûts]\n';
    expect(detectSourceLoss(previous, candidate)).toEqual([
      { path: 'raw/ingested/a.md', anchor: 'Garanties' },
    ]);
  });
});
