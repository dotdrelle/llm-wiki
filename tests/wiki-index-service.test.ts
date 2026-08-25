import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { regenerateWikiIndex } from '../src/services/wikiIndexService.ts';

/*
 Regression coverage for a confirmed defect: `wiki/index.md` used to be
 written by the consolidation LLM per source. On a real workspace the bullet
 count oscillated 4-7 across 13 consecutive ingests instead of growing, and
 ended up listing 2 of 22 real concept pages. This module replaces that with
 a deterministic scan of wiki/concepts/** and wiki/sources/*.
*/

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'));
  await mkdir(path.join(root, 'wiki'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('regenerateWikiIndex', () => {
  it('writes the empty-workspace placeholders when nothing exists yet', async () => {
    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toEqual({ status: 'written', concepts: 0, sources: 0 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- No concepts yet.');
    expect(content).toContain('- No source notes yet.');
  });

  it('lists every concept page on disk, across class subfolders and legacy flat pages', async () => {
    await mkdir(path.join(root, 'wiki', 'concepts', 'offre-marche'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'offre-marche', 'jedox.md'),
      '---\nclass: offre-marche\nsubject: jedox\n---\n# Jedox\n\nUn éditeur EPM.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'unclassified', 'orphan.md'),
      '# Orphan concept\n\nNot filed yet.\n',
      'utf8',
    );
    // A pre-grid, flat legacy page directly under wiki/concepts/.
    await writeFile(path.join(root, 'wiki', 'concepts', 'legacy.md'), '# Legacy concept\n', 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toEqual({ status: 'written', concepts: 3, sources: 0 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- [Jedox](concepts/offre-marche/jedox.md)');
    expect(content).toContain('- [Orphan concept](concepts/unclassified/orphan.md)');
    expect(content).toContain('- [Legacy concept](concepts/legacy.md)');
  });

  it('never lists wiki/concepts-grid.md as a concept, and lists source notes separately', async () => {
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), '# Concepts grid\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'sources', 'note.md'), '# A source note\n', 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toEqual({ status: 'written', concepts: 0, sources: 1 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- [A source note](sources/note.md)');
    expect(content).not.toContain('concepts-grid');
  });

  it('falls back to the filename when a page has neither frontmatter title/subject nor a heading', async () => {
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts', 'bare-page.md'), 'Just a paragraph, no heading.\n', 'utf8');

    await regenerateWikiIndex(root);
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- [bare-page](concepts/bare-page.md)');
  });

  it('is idempotent: regenerating twice with no disk change produces byte-identical output', async () => {
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts', 'a.md'), '# A\n', 'utf8');

    await regenerateWikiIndex(root);
    const first = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    await regenerateWikiIndex(root);
    const second = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(second).toBe(first);
  });
});
