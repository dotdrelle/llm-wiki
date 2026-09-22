import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEvidenceManifest,
  manifestFragment,
  resolveEvidence,
} from '../src/provenance/resolver.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig, WikiOperation } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'en',
    mcp: {},
    limits: { requestsPerMinute: 10, maxInputTokensPerCall: 50000, targetInputTokensPerCall: 40000, maxProfileChars: 4000 },
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

describe('provenance end-to-end gate (lot 5)', () => {
  it('A + B + C compose one leaf, A-v2 keeps the frozen proof', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-gate-'));
    const workspace = new WorkspaceService(createConfig(root));
    await workspace.initWorkspace({});
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });

    const rawA1 = '# A\n\n## Coûts\n\nA coûts v1.\n';
    const rawB = '# B\n\n## Garanties\n\nB garanties.\n';
    const rawC = '# C\n\n## Coûts\n\nC contredit A.\n';
    await writeFile(path.join(root, 'raw', 'ingested', 'a.md'), rawA1, 'utf8');
    await writeFile(path.join(root, 'raw', 'ingested', 'b.md'), rawB, 'utf8');
    await writeFile(path.join(root, 'raw', 'ingested', 'c.md'), rawC, 'utf8');

    const sourcePage = (doc: string, body: string): WikiOperation => ({
      type: 'create',
      path: `wiki/sources/${doc}.md`,
      content: `---\ntype: source\nsubject: ${doc}\nsources:\n  - path: raw/ingested/${doc}.md\n---\n\n# ${doc.toUpperCase()}\n\n${body}\n`,
    });
    await workspace.applyNormalizedWikiOperations([
      sourcePage('a', '## Coûts\n\nA coûts v1.\n\n[src: raw/ingested/a.md#Coûts]'),
      sourcePage('b', '## Garanties\n\nB garanties.\n\n[src: raw/ingested/b.md#Garanties]'),
    ]);

    // The leaf is written the way the model would: it cites the source pages,
    // and declares one source it never reaches (a phantom).
    const leaf = 'wiki/concepts/demo/topic.md';
    const leafBody = (extra: string): string =>
      `---\ntype: product\nstatus: draft\nsources:\n  - path: raw/ingested/phantom.md\n---\n\n# Topic\n\n## Coûts\n\n[src: wiki/sources/a.md#Coûts]\n\n## Garanties\n\n[src: wiki/sources/b.md#Garanties]\n${extra}`;
    await workspace.applyNormalizedWikiOperations([{ type: 'create', path: leaf, content: leafBody('') }]);

    const afterAB = await readFile(path.join(root, leaf), 'utf8');
    // sources: derived through the source pages to the archives (sorted), and
    // the phantom entry is gone.
    expect(afterAB).toContain('raw/ingested/a.md');
    expect(afterAB).toContain('raw/ingested/b.md');
    expect(afterAB).not.toContain('phantom.md');

    // C joins, contextualised as a third section.
    await workspace.applyNormalizedWikiOperations([
      sourcePage('c', '## Coûts\n\nC contredit A.\n\n[src: raw/ingested/c.md#Coûts]'),
      {
        type: 'update',
        path: leaf,
        content: leafBody('\n## Contradiction\n\n[src: wiki/sources/c.md#Coûts]\n'),
      },
    ]);

    const finalLeaf = await readFile(path.join(root, leaf), 'utf8');
    expect(finalLeaf).toContain('raw/ingested/c.md');

    // Build freezes the terminal fragments.
    const loadDocument = (documentPath: string): string | null => {
      try {
        return readFileSync(path.join(root, documentPath), 'utf8');
      } catch {
        return null;
      }
    };
    const { fragments, degradations } = resolveEvidence({ content: finalLeaf, loadDocument });
    expect(degradations).toEqual([]);
    expect(fragments.map((fragment) => fragment.path).sort()).toEqual([
      'raw/ingested/a.md',
      'raw/ingested/b.md',
      'raw/ingested/c.md',
    ]);
    const manifest = createEvidenceManifest('gate', fragments);

    // A-v2 replaces A-v1 after the build: the manifest still answers A-v1.
    await writeFile(path.join(root, 'raw', 'ingested', 'a.md'), '# A\n\n## Coûts\n\nA coûts v2.\n', 'utf8');
    expect(manifestFragment(manifest, 'raw/ingested/a.md', 'Coûts')?.text).toContain('v1');
  });
});
