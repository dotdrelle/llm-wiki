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
 a deterministic scan of project knowledge, reading notes, and archived documents.
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
    expect(outcome).toEqual({ status: 'written', concepts: 0, sources: 0, archives: 0 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- No project knowledge pages yet.');
    expect(content).toContain('- No reading notes yet.');
    expect(content).toContain('- No archived documents yet.');
    expect(content).toContain('type: index');
  });

  it('lists reading notes by their title, accents and case ignored, not by source folder', async () => {
    const write = async (rel: string, title: string) => {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), `---\ntitle: ${title}\n---\n# ${title}\n`, 'utf8');
    };
    // juno: "Bilan", "Démo", "Divers", "Étude" from one folder, then
    // "Open-Source…" and "Demo Project Brief" from others.
    await write('wiki/sources/a-folder/etude.md', 'Étude des exigences');
    await write('wiki/sources/a-folder/bilan.md', 'Bilan');
    await write('wiki/sources/b-folder/demo.md', 'Demo Project Brief');
    await write('wiki/sources/c-folder/open.md', 'Open-Source Alternatives');
    await write('wiki/sources/c-folder/item10.md', 'Item 10');
    await write('wiki/sources/c-folder/item2.md', 'Item 2');
    await regenerateWikiIndex(root);
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    const section = content.slice(content.indexOf('## Reading notes'), content.indexOf('## Archived documents'));
    const labels = [...section.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]);
    expect(labels).toEqual(['Bilan', 'Demo Project Brief', 'Étude des exigences', 'Item 2', 'Item 10', 'Open-Source Alternatives']);
  });

  it('lists every concept page on disk, across class subfolders and legacy flat pages', async () => {
    await mkdir(path.join(root, 'wiki', 'concepts', 'market-offering'), { recursive: true });
    await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'market-offering', 'quartz.md'),
      '---\nclass: market-offering\nsubject: quartz\n---\n# Quartz\n\nAn EPM vendor.\n',
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
    expect(outcome).toEqual({ status: 'written', concepts: 3, sources: 0, archives: 0 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- [Quartz](concepts/market-offering/quartz.md)');
    expect(content).toContain('- [Orphan concept](concepts/unclassified/orphan.md)');
    expect(content).toContain('- [Legacy concept](concepts/legacy.md)');
  });

  it('never lists wiki/concepts-grid.md as a concept, and lists source notes separately', async () => {
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), '# Concepts grid\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'sources', 'note.md'), '# A source note\n', 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toEqual({ status: 'written', concepts: 0, sources: 1, archives: 0 });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('- [A source note](sources/note.md)');
    expect(content).not.toContain('concepts-grid');
  });

  it('lists original archived documents separately and links them from wiki/index.md', async () => {
    await mkdir(path.join(root, 'raw/ingested'), { recursive: true });
    await writeFile(path.join(root, 'raw/ingested/original.md'), '# Original title\n\nFull evidence.\n', 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toEqual({ status: 'written', concepts: 0, sources: 0, archives: 1 });
    const content = await readFile(path.join(root, 'wiki/index.md'), 'utf8');
    expect(content).toContain('## Archived documents');
    expect(content).toContain('- [Original title](../raw/ingested/original.md)');
    expect(content).toContain('complete archived original');
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

  it('migrates a legacy generated index instead of failing forever on missing markers', async () => {
    await writeFile(path.join(root, 'wiki', 'index.md'), [
      '---', 'type: index', 'title: Wiki Index', '---', '# Wiki Index', '',
      '## Concepts', '',
      '- [Old concept](concepts/old/old.md)', '',
    ].join('\n'), 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).toMatchObject({ status: 'written', migrated: true });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain('<!-- wiki-index-overview:start -->');
    expect(content).toContain('## Project knowledge');
    expect(content).not.toContain('Old concept');
  });

  it('adopts a marker-less hand-written body as the initial overview instead of dropping it', async () => {
    const prose = 'Ce workspace couvre le chiffrage ACPI.';
    await writeFile(path.join(root, 'wiki', 'index.md'), `# Wiki Index\n\n${prose}\n`, 'utf8');

    const outcome = await regenerateWikiIndex(root);
    expect(outcome).not.toMatchObject({ migrated: true });
    const content = await readFile(path.join(root, 'wiki', 'index.md'), 'utf8');
    expect(content).toContain(prose);
  });
});
