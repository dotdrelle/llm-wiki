import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWikiGraph, listWikiGraphFiles } from '../src/graph/wiki/projection.ts';

async function fixtureWorkspace(): Promise<string> {
  const root = path.join(tmpdir(), `wiki-graph-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path.join(root, 'wiki/concepts/domain'), { recursive: true });
  await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
  await mkdir(path.join(root, 'raw/ingested'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await mkdir(path.join(root, 'build-context'), { recursive: true });
  await mkdir(path.join(root, 'deliverables'), { recursive: true });
  await writeFile(path.join(root, 'wiki/concepts/domain/main.md'), [
    '---',
    'group: Domain',
    '---',
    '# Main',
    '[Source](../../sources/source.md)',
    '[src: raw/untracked/source-a.md]',
    '[Raw](../../../raw/untracked/source-a.md)',
    '[Template](../../../templates/report.md)',
    '[Context](../../../build-context/audience.md)',
    '[[Sibling]]',
  ].join('\n'));
  await writeFile(path.join(root, 'wiki/concepts/domain/sibling.md'), '# Sibling\n');
  await writeFile(path.join(root, 'wiki/sources/source.md'), '# Source\n');
  await writeFile(path.join(root, 'raw/ingested/source-a.md'), '# Raw\n');
  await writeFile(path.join(root, 'templates/report.md'), '# Template\n');
  await writeFile(path.join(root, 'build-context/audience.md'), '# Context\n');
  await writeFile(path.join(root, 'deliverables/report.md'), '# Deliverable\n[Main](../wiki/concepts/domain/main.md)\n');
  return root;
}

describe('wiki graph projection', () => {
  it('projects wiki pages, sources, templates, context and deliverables with document relation types', async () => {
    const root = await fixtureWorkspace();
    const files = await listWikiGraphFiles(root);
    const graph = await buildWikiGraph(root, {
      decodeHrefPath: (href) => href,
      hrefToRelativePath: (href, currentDir = '') => path.posix.normalize(path.posix.join(currentDir, href)).replace(/^\.\.\//, ''),
      humanTitle: (value) => path.basename(value, '.md'),
      renderMarkdown: async (raw) => raw,
    }, files);

    expect(graph.nodes.map((node) => node.type)).toEqual(expect.arrayContaining([
      'wiki',
      'wiki-source',
      'raw-source',
      'template',
      'build-context',
      'deliverable',
    ]));
    expect(graph.nodes.find((node) => node.id === 'wiki/concepts/domain/main.md')?.secondary).toContain('Domain');
    expect(graph.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining([
      'links_to',
      'cites',
      'generated_from',
      'uses_template',
      'uses_context',
      'related_to',
    ]));
    expect(graph.nodes.some((node) => node.ring === 0)).toBe(true);
  });
});
