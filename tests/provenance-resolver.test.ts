import matter from 'gray-matter';
import { BuildService } from '../src/services/buildService.ts';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEvidenceManifest,
  evidenceBuildIdFor,
  frozenFragmentMap,
  listEvidenceBuilds,
  manifestFragment,
  readEvidenceManifest,
  resolveEvidence,
  writeEvidenceManifest,
} from '../src/provenance/resolver.ts';
import { expandDeliverable } from '../src/services/exportService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    mcp: {},
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: { refreshOnIngest: true, slotBatchSize: 5, maxBuildContextChars: 12000 },
    retrieval: {
      maxContextFiles: 5,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: 'https://example.invalid',
        timeoutMs: 600000,
        embeddingModel: 'embedding',
        rerankEnabled: false,
        rerankerModel: 'rerank',
        topK: 20,
        rerankTopK: 10,
        maxResults: 5,
      },
    },
    llm: {
      provider: 'openai-compatible',
      engine: 'generic',
      baseUrl: 'https://example.invalid',
      apiKey: 'test',
      model: 'model',
      timeoutMs: 600000,
      temperature: 0,
    },
  };
}

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
    expect(chained?.chain).toEqual([{ path: 'wiki/sources/a.md', anchor: 'Coûts' }]);
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

  it('rejects a schema v1 manifest whose chain cannot preserve anchors', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-manifest-v1-'));
    const buildId = 'legacy';
    const directory = path.join(root, '.wiki', 'builds', buildId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'evidence.json'),
      JSON.stringify({ schemaVersion: 1, buildId, createdAt: '2026-01-01T00:00:00.000Z', fragments: [] }),
      'utf8',
    );

    await expect(readEvidenceManifest(root, buildId)).resolves.toBeNull();
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
      schemaVersion: 2 as const,
      buildId: 'b',
      createdAt: '2026-01-01T00:00:00.000Z',
      fragments: [{
        path: 'raw/ingested/a.md',
        anchor: 'Coûts',
        hash: 'x',
        text: 'FROZEN A-v1',
        chain: [
          { path: 'wiki/concepts/produit/x.md', anchor: 'Coûts' },
          { path: 'wiki/sources/a.md', anchor: null },
        ],
      }],
    };
    const map = frozenFragmentMap(manifest);
    // Keyed by path#anchor, so a section only receives the fragments it used.
    expect(map.get('raw/ingested/a.md#Coûts')).toContain('FROZEN A-v1');
    expect(map.get('wiki/concepts/produit/x.md#Coûts')).toContain('FROZEN A-v1');
    expect(map.get('wiki/sources/a.md#')).toContain('FROZEN A-v1');
  });

  it('keeps a frozen entry for every chain that reached the same fragment', () => {
    const docs = new Map<string, string>([
      ['wiki/sources/a.md', '# A\n\n## Coûts\n\n[src: raw/ingested/detailed.md#Coûts]\n'],
      ['wiki/concepts/one.md', '# One\n\n[src: wiki/sources/a.md#Coûts]\n'],
      ['wiki/concepts/two.md', '# Two\n\n[src: wiki/sources/a.md#Coûts]\n'],
      ['raw/ingested/detailed.md', '# Detailed\n\n## Coûts\n\n90 k€.\n'],
    ]);
    const content = '# D\n\n[src: wiki/concepts/one.md#One]\n[src: wiki/concepts/two.md#Two]\n';
    const { fragments } = resolveEvidence({ content, loadDocument: (p) => docs.get(p) ?? null });
    const map = frozenFragmentMap(createEvidenceManifest('b', fragments));
    expect(map.get('wiki/concepts/one.md#One')).toContain('90 k€');
    expect(map.get('wiki/concepts/two.md#Two')).toContain('90 k€');
  });
});

describe('evidence build ids (defect 4)', () => {
  it('does not overwrite the first build when identical text rests on different evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-clobber-'));
    const base = evidenceBuildIdFor('deliverables/d.md', 'samecontenthash');
    const fragment = (text: string, hash: string) => ({
      path: 'raw/ingested/a.md',
      anchor: 'Coûts',
      hash,
      text,
      chain: [],
      extraChains: [],
    });
    await writeEvidenceManifest(root, createEvidenceManifest(base, [fragment('A-v1', 'h1')]));
    await writeEvidenceManifest(root, createEvidenceManifest(base, [fragment('A-v2', 'h2')]));

    const first = await readEvidenceManifest(root, base);
    expect(frozenFragmentMap(first!).get('raw/ingested/a.md#Coûts')).toContain('A-v1');
    const builds = await listEvidenceBuilds(root, 'deliverables/d.md');
    expect(builds.length).toBe(2);
  });
});

describe('two builds, two manifests, two exports (release review)', () => {
  it('keeps both manifests and makes expandDeliverable use the explicitly selected build', async () => {
    const { hashText } = await import('../src/utils/hash.ts');
    const { writeEvidenceManifest, evidenceBuildIdFor, listEvidenceBuilds, frozenFragmentMap, readEvidenceManifest } =
      await import('../src/provenance/resolver.ts');
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-two-builds-'));
    const docs = new Map(DOCS);

    const content1 = '# Deliverable\n\n[src: wiki/sources/a.md#Coûts]\n';
    const frag1 = resolveEvidence({ content: content1, loadDocument: load(docs) }).fragments;
    const id1 = evidenceBuildIdFor('deliverables/d.md', hashText(content1));
    await writeEvidenceManifest(root, createEvidenceManifest(id1, frag1));

    // A-v2 replaces A-v1 before the second build.
    docs.set('raw/ingested/detailed.md', '# Detailed\n\n## Coûts\n\n120 k€.\n');
    const content2 = '# Deliverable\n\n[src: wiki/sources/a.md#Coûts] second\n';
    const frag2 = resolveEvidence({ content: content2, loadDocument: load(docs) }).fragments;
    const id2 = evidenceBuildIdFor('deliverables/d.md', hashText(content2));
    await writeEvidenceManifest(root, createEvidenceManifest(id2, frag2));

    expect(id1).not.toBe(id2);
    const builds = await listEvidenceBuilds(root, 'deliverables/d.md');
    expect([...builds].sort()).toEqual([id1, id2].sort());

    // Exporting the first build still resolves A-v1 from its own manifest.
    const first = await readEvidenceManifest(root, id1);
    expect(frozenFragmentMap(first!).get('wiki/sources/a.md#Coûts')).toContain('90 k€');
    const second = await readEvidenceManifest(root, id2);
    expect(frozenFragmentMap(second!).get('wiki/sources/a.md#Coûts')).toContain('120 k€');

    await mkdir(path.join(root, 'deliverables'), { recursive: true });
    await writeFile(path.join(root, 'deliverables', 'd.md'), content2, 'utf8');
    const workspace = new WorkspaceService(createConfig(root));
    const prompts: string[] = [];
    const llm = {
      completeText: async (request: { user: string }): Promise<string> => {
        prompts.push(request.user);
        return 'Analyse détaillée fondée sur la preuve sélectionnée.';
      },
    };
    const retrieval = { search: async (): Promise<never[]> => [] };
    const logger = {
      info: async (): Promise<void> => undefined,
      warn: async (): Promise<void> => undefined,
    };

    await expandDeliverable(
      'deliverables/d.md',
      createConfig(root),
      workspace,
      retrieval as never,
      llm as never,
      logger as never,
      undefined,
      { evidenceBuildId: id1 },
    );
    expect(prompts.at(-1)).toContain('90 k€');
    expect(prompts.at(-1)).not.toContain('120 k€');

    await expandDeliverable(
      'deliverables/d.md',
      createConfig(root),
      workspace,
      retrieval as never,
      llm as never,
      logger as never,
      undefined,
      { evidenceBuildId: id2 },
    );
    expect(prompts.at(-1)).toContain('120 k€');
    expect(prompts.at(-1)).not.toContain('90 k€');
  });
});


describe('build evidence regression coverage', () => {
  it('preserves manifests when only primary or additional citation chains change', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-chain-history-'));
    const fragments = resolveEvidence({ content: '[src: wiki/sources/a.md#Coûts]', loadDocument: load(new Map(DOCS)) }).fragments;
    const first = createEvidenceManifest('base', fragments);
    const firstPath = await writeEvidenceManifest(root, first);
    const second = structuredClone(first);
    second.fragments[0].chain = [{ path: 'wiki/concepts/other.md', anchor: 'Costs' }];
    const secondPath = await writeEvidenceManifest(root, second);
    const third = structuredClone(second);
    third.fragments[0].extraChains = [[{ path: 'wiki/concepts/third.md', anchor: 'Costs' }]];
    const thirdPath = await writeEvidenceManifest(root, third);
    expect(new Set([firstPath, secondPath, thirdPath]).size).toBe(3);
    expect((await readEvidenceManifest(root, 'base'))?.fragments).toEqual(first.fragments);
    expect(await writeEvidenceManifest(root, third)).toBe(thirdPath);
  });

  it('automatically exports the matching evidence for two builds with identical prose', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-build-evidence-'));
    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await writeFile(path.join(root, 'wiki/index.md'), '# Wiki');
    await mkdir(path.join(root, 'raw/ingested'), { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await writeFile(path.join(root, 'templates/test.md'), '# Test\n\n[src: wiki/sources/a.md#Coûts]\n');
    await writeFile(path.join(root, 'wiki/sources/a.md'), '## Coûts\n[src: raw/ingested/a.md#Coûts]');
    const prompts: string[] = [];
    const llm = { completeText: async (request: { user: string }) => {
      prompts.push(request.user);
      return 'Analyse détaillée fondée sur la preuve sélectionnée.';
    } };
    const retrieval = { search: async () => [], warmCache: async () => [] };
    const logger = { info: async () => undefined, warn: async () => undefined };
    const builder = new BuildService(config, workspace, llm as never, retrieval as never);
    const contents: string[] = [];
    for (const amount of ['90 k€', '120 k€']) {
      await writeFile(path.join(root, 'raw/ingested/a.md'), `## Coûts\n${amount}`);
      const results = await builder.build({ templates: ['templates/test.md'], force: true });
      expect(results[0].output).toBe('deliverables/test.md');
      contents.push(await workspace.readTextFile(path.join(root, 'deliverables/test.md')));
    }
    expect(matter(contents[0]).content).toBe(matter(contents[1]).content);
    expect(matter(contents[0]).data.evidence_build_id).not.toBe(matter(contents[1]).data.evidence_build_id);
    for (const [index, amount] of ['90 k€', '120 k€'].entries()) {
      await writeFile(path.join(root, 'deliverables/test.md'), contents[index]);
      await expandDeliverable('deliverables/test.md', config, workspace, retrieval as never, llm as never, logger as never);
      expect(prompts.at(-1)).toContain(amount);
      expect(prompts.at(-1)).not.toContain(index === 0 ? '120 k€' : '90 k€');
    }
  });
});
