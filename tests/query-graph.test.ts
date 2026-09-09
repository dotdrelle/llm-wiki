import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildQueryGraph, graphNeighbors, graphNodesByConcept, graphNodesByTag, graphShortestPath } from '../src/graph/wiki/queryGraph.ts';

type FakeWorkspace = {
  listWikiPages: () => Promise<Array<{ relativePath: string; name: string; type: string; content: string }>>;
  listIngestedSourcePages: () => Promise<Array<{ relativePath: string; name: string; type: string; content: string }>>;
};

function makeWorkspace(rootDir: string, files: Record<string, string>): FakeWorkspace {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(rootDir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  const page = (relative: string, type: string) => ({
    relativePath: relative,
    name: path.basename(relative, '.md'),
    type,
    content: '',
  });
  return {
    async listWikiPages() {
      return Object.keys(files)
        .filter((relative) => relative.startsWith('wiki/'))
        .map((relative) => {
          const parsed = files[relative].split('\n').find((line) => line.startsWith('type:'))?.replace('type:', '').trim();
          return { ...page(relative, parsed ?? 'other'), content: files[relative] };
        });
    },
    async listIngestedSourcePages() {
      return Object.keys(files)
        .filter((relative) => relative.startsWith('raw/ingested/'))
        .map((relative) => ({ ...page(relative, 'source'), content: files[relative] }));
    },
  };
}

function workspaceFixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'query-graph-'));
  return {
    rootDir,
    workspace: makeWorkspace(rootDir, {
      'wiki/concepts/product/openbooks.md': [
        '---',
        'type: concept',
        'subject: openbooks',
        'tags: [finance, cloud]',
        '---',
        '# OpenBooks',
        'Fact [src: raw/ingested/benchmark.md]',
        '',
        'See [[wiki/concepts/security/securo]] for the security comparison.',
      ].join('\n'),
      'wiki/concepts/product/other-ledger.md': [
        '---',
        'type: concept',
        'subject: other-ledger',
        'tags: [finance]',
        '---',
        '# Other Ledger',
        'Fact [src: raw/ingested/benchmark.md]',
      ].join('\n'),
      'wiki/concepts/security/securo.md': [
        '---',
        'type: concept',
        'subject: securo',
        'tags: [cloud]',
        '---',
        '# Securo',
      ].join('\n'),
      'raw/ingested/benchmark.md': '# Benchmark\n\nSource text\n',
    }),
  };
}

describe('buildQueryGraph', () => {
  it('materializes citations, wiki links, shared subjects and shared tags', async () => {
    const { workspace } = workspaceFixture();
    const graph = await buildQueryGraph(workspace as never);

    expect(graph.nodeById.has('wiki/concepts/product/openbooks')).toBe(true);
    expect(graph.nodeById.has('raw/ingested/benchmark')).toBe(true);

    const edges = (id: string) => graph.adjacency.get(id) ?? [];
    expect(edges('wiki/concepts/product/openbooks').some((entry) => entry.to === 'raw/ingested/benchmark' && entry.type === 'citation')).toBe(true);
    expect(edges('wiki/concepts/product/openbooks').some((entry) => entry.to === 'wiki/concepts/security/securo' && entry.type === 'wiki_link')).toBe(true);
    expect(edges('wiki/concepts/product/openbooks').some((entry) => entry.to === 'wiki/concepts/product/other-ledger' && entry.type === 'shared_tag')).toBe(true);
    expect(edges('wiki/concepts/product/openbooks').some((entry) => entry.to === 'wiki/concepts/security/securo' && entry.type === 'shared_tag')).toBe(true);
  });

  it('answers shortest path with the edge type of every hop', async () => {
    const { workspace } = workspaceFixture();
    const graph = await buildQueryGraph(workspace as never);

    const path = graphShortestPath(graph, 'raw/ingested/benchmark', 'wiki/concepts/security/securo');
    expect(path).not.toBeNull();
    // benchmark --(produces)--> openbooks --(wiki_link)--> securo
    expect(path![0].node.id).toBe('raw/ingested/benchmark');
    expect(path![1].node.id).toBe('wiki/concepts/product/openbooks');
    expect(path![2].node.id).toBe('wiki/concepts/security/securo');
    expect(path![1].edgeType).toBe('produces');
    expect(path![2].edgeType).toBe('wiki_link');
  });

  it('restricts traversal by edge type', async () => {
    const { workspace } = workspaceFixture();
    const graph = await buildQueryGraph(workspace as never);

    expect(graphShortestPath(graph, 'raw/ingested/benchmark', 'wiki/concepts/security/securo', { edgeTypes: ['wiki_link'] })).toBeNull();
    const viaCitations = graphShortestPath(graph, 'raw/ingested/benchmark', 'wiki/concepts/security/securo', { edgeTypes: ['produces', 'shared_tag'] });
    expect(viaCitations).not.toBeNull();
    // produces + shared_tag: benchmark -> openbooks -> securo (shared_tag cloud)
    expect(viaCitations!.at(-1)!.edgeType).toBe('shared_tag');
  });

  it('lists concept and tag members, and neighbors with depth', async () => {
    const { workspace } = workspaceFixture();
    const graph = await buildQueryGraph(workspace as never);

    expect(graphNodesByConcept(graph, 'product')).toHaveLength(2);
    expect(graphNodesByTag(graph, 'finance')).toHaveLength(2);
    expect(graphNodesByTag(graph, 'cloud')).toHaveLength(2);

    const neighbors = graphNeighbors(graph, 'raw/ingested/benchmark', { maxDepth: 1 });
    expect(neighbors.map((entry) => entry.node.id)).toEqual([
      'wiki/concepts/product/openbooks',
      'wiki/concepts/product/other-ledger',
    ]);
    const deeper = graphNeighbors(graph, 'raw/ingested/benchmark', { maxDepth: 2 });
    expect(deeper.some((entry) => entry.node.id === 'wiki/concepts/security/securo' && entry.depth === 2)).toBe(true);
  });
});
