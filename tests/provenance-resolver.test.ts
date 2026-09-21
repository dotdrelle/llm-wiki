import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEvidenceManifest,
  evidenceBuildIdFor,
  manifestFragment,
  readEvidenceManifest,
  resolveEvidence,
  writeEvidenceManifest,
} from '../src/provenance/resolver.ts';

const DOCS = new Map<string, string>([
  ['wiki/sources/a.md', '# A\n\n## Coûts\n\n[src: raw/ingested/detailed.md#Coûts]\n'],
  ['raw/ingested/detailed.md', '# Detailed\n\n## Coûts\n\n90 k€.\n'],
  ['raw/ingested/direct.md', '# Direct\n\n## Tarifs\n\n12 k€.\n'],
]);

const load = (source: Map<string, string>) => (documentPath: string): string | null =>
  source.get(documentPath) ?? null;

describe('evidence resolver (lot 4)', () => {
  it('follows the chain to terminal fragments only', () => {
    const content = '# Leaf\n\n## Coûts\n\n[src: wiki/sources/a.md#Coûts]\n\n## Tarifs\n\n[src: raw/ingested/direct.md#Tarifs]\n';
    const { fragments, degradations } = resolveEvidence({ content, loadDocument: load(DOCS) });

    const keys = fragments.map((fragment) => `${fragment.path}#${fragment.anchor}`).sort();
    expect(keys).toEqual(['raw/ingested/detailed.md#Coûts', 'raw/ingested/direct.md#Tarifs']);
    expect(degradations).toEqual([]);

    const chained = fragments.find((fragment) => fragment.path.endsWith('detailed.md'));
    expect(chained?.chain).toEqual(['wiki/sources/a.md']);
    expect(chained?.text).toContain('90 k€');
  });

  it('announces an unanchored legacy citation instead of widening silently', () => {
    const content = '# Leaf\n\n[src: raw/ingested/direct.md]\n';
    const { fragments, degradations } = resolveEvidence({ content, loadDocument: load(DOCS) });
    expect(fragments.length).toBe(1);
    expect(fragments[0].anchor).toBe('');
    expect(degradations.some((entry) => entry.includes('unanchored'))).toBe(true);
  });

  it('announces a missing anchor and produces no fragment for it', () => {
    const content = '# Leaf\n\n[src: raw/ingested/direct.md#Absent]\n';
    const { fragments, degradations } = resolveEvidence({ content, loadDocument: load(DOCS) });
    expect(fragments).toEqual([]);
    expect(degradations.some((entry) => entry.includes('missing anchor'))).toBe(true);
  });

  it('keeps the built fragment text after the archive is replaced', () => {
    const content = '# Leaf\n\n[src: raw/ingested/detailed.md#Coûts]\n';
    const { fragments } = resolveEvidence({ content, loadDocument: load(DOCS) });
    const manifest = createEvidenceManifest('build-1', fragments, '2026-01-01T00:00:00.000Z');
    expect(manifestFragment(manifest, 'raw/ingested/detailed.md', 'Coûts')?.text).toContain('90 k€');

    const replaced = new Map(DOCS);
    replaced.set('raw/ingested/detailed.md', '# Detailed\n\n## Coûts\n\n120 k€.\n');
    const second = resolveEvidence({ content, loadDocument: load(replaced) });
    expect(second.fragments[0].text).toContain('120 k€');
    // The first build still answers with A-v1.
    expect(manifestFragment(manifest, 'raw/ingested/detailed.md', 'Coûts')?.text).toContain('90 k€');
  });
});

describe('evidence manifest storage (lot 4)', () => {
  it('writes and reads a manifest under .wiki/builds/<id>', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-manifest-'));
    const content = '# Leaf\n\n[src: raw/ingested/detailed.md#Coûts]\n';
    const { fragments } = resolveEvidence({ content, loadDocument: load(DOCS) });
    const buildId = evidenceBuildIdFor('deliverables/architecture/out.md');
    const target = await writeEvidenceManifest(root, createEvidenceManifest(buildId, fragments));

    expect(target).toContain(path.join('.wiki', 'builds'));
    const read = await readEvidenceManifest(root, buildId);
    expect(read?.fragments).toHaveLength(1);
    expect(read?.fragments[0].text).toContain('90 k€');
    expect(evidenceBuildIdFor('deliverables/architecture/out.md')).toBe(buildId);
  });
});

describe('manifest build ids (defect 3)', () => {
  it('separates two builds of the same deliverable by content hash', () => {
    const a = evidenceBuildIdFor('deliverables/x.md', 'a'.repeat(64));
    const b = evidenceBuildIdFor('deliverables/x.md', 'b'.repeat(64));
    expect(a).not.toBe(b);
    expect(a.startsWith(evidenceBuildIdFor('deliverables/x.md'))).toBe(true);
  });
});

describe('frozen fragment map (defect 3)', () => {
  it('keys a fragment by every page in its chain, not only the terminal path', async () => {
    const { frozenFragmentMap } = await import('../src/provenance/resolver.ts');
    const manifest = {
      schemaVersion: 1 as const,
      buildId: 'b',
      createdAt: '2026-01-01T00:00:00.000Z',
      fragments: [{
        path: 'raw/ingested/a.md',
        anchor: 'Coûts',
        hash: 'x',
        text: 'FROZEN A-v1',
        chain: ['wiki/concepts/produit/x.md', 'wiki/sources/a.md'],
      }],
    };
    const map = frozenFragmentMap(manifest);
    expect(map.get('raw/ingested/a.md')).toContain('FROZEN A-v1');
    expect(map.get('wiki/concepts/produit/x.md')).toContain('FROZEN A-v1');
    expect(map.get('wiki/sources/a.md')).toContain('FROZEN A-v1');
  });
});
