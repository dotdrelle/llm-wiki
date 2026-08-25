import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { knowledgeEtag } from '../src/graph/wiki/taxonomy/knowledge.ts';
import { readMarker } from '../src/graph/wiki/taxonomy/store.ts';

// The command builds its own LLMService internally (no dependency injection
// for `propose`), so the LLM call is stubbed at the module level rather than
// through a constructor argument.
vi.mock('../src/services/llmService.ts', () => ({
  LLMService: class {
    async completeJson() {
      return { assignments: { 'wiki/concepts/unclassified/jedox.md': 'offre-marche' } };
    }
  },
}));

const { default: reclassifyConceptsCmd } = await import('../src/commands/reclassifyConcepts.ts');

/*
 Reproduces a real deadlock found on a live workspace: `wiki taxonomy --apply
 --expected-corpus <fresh fingerprint>` failed identically on three
 consecutive attempts with "Corpus changed while synthesizing", even though
 nothing else was writing to the workspace. Root cause: `reclassify-concepts`
 moves pages under wiki/concepts/**, which IS part of the knowledge corpus,
 but never republished the taxonomy marker — so the marker stayed pinned to
 whatever corpus existed before the move, forever behind the live corpus, and
 every subsequent taxonomy synthesis's compare-and-swap rejected it as stale.
 `reclassifyConceptsCmd` must now call `publishCorpusRevision` after an
 actual move so the marker catches up and the next taxonomy synthesis's
 --expected-corpus lines up with it again.
*/

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      engine: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: false,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

const GRID_MD = [
  '# Concepts grid',
  '',
  '```yaml',
  'class:',
  '  - offre-marche',
  '  - economie-projet',
  '```',
  '',
].join('\n');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-reclassify-cmd-'));
  await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
  await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
  await writeFile(
    path.join(root, 'wiki', 'concepts', 'unclassified', 'jedox.md'),
    '---\nclass: unclassified\nsubject: jedox\n---\n# Jedox\n\nUn éditeur EPM.\n',
    'utf8',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reclassifyConceptsCmd', () => {
  it('republishes the taxonomy marker to the post-move corpus after moving a page', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await readMarker(root)).toBeNull();

    await reclassifyConceptsCmd(createConfig(root), { apply: true });

    const marker = await readMarker(root);
    expect(marker).not.toBeNull();
    expect(marker!.corpus).toBe(await knowledgeEtag(root));

    // Regression: wiki/index.md used to be LLM-authored per source and drift
    // out of sync with the actual concept tree (confirmed on a live workspace:
    // 2 of 22 real pages listed after 13 ingests). A move must regenerate it
    // deterministically, and the move must be traceable in wiki/log.md, which
    // previously only ingest ever wrote to.
    const index = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(index).toContain('- [Jedox](concepts/offre-marche/jedox.md)');
    const log = await readFile(path.join(root, 'wiki', 'log.md'), 'utf8');
    expect(log).toContain('reclassify-concepts');
    expect(log).toContain('wiki/concepts/unclassified/jedox.md -> wiki/concepts/offre-marche/jedox.md');
  });

  it('does not publish a marker when nothing was moved', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // No unclassified page this time: the grid exists but there is nothing
    // to reclassify, so the corpus never actually moves.
    const empty = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-reclassify-cmd-empty-'));
    await mkdir(path.join(empty, 'wiki', 'concepts', 'unclassified'), { recursive: true });
    await writeFile(path.join(empty, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(path.join(empty, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');

    await reclassifyConceptsCmd(createConfig(empty), { apply: true });

    expect(await readMarker(empty)).toBeNull();
    // Nothing moved: no log entry at all — appendLog is never called, so
    // wiki/log.md (never created by this fixture) stays absent.
    await expect(readFile(path.join(empty, 'wiki', 'log.md'), 'utf8')).rejects.toThrow();
  });
});
