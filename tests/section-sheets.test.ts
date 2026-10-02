import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractSectionSheets,
  parseTaxoSheet,
  sectionSheetPath,
  sectionSheetSubject,
} from '../src/ingest/sectionSheets.ts';
import { exactSheetDuplicate, sheetContentHash } from '../src/ingest/sheetDedup.ts';

describe('TAXO section sheets', () => {
  it('matches the synthetic prototype corpus: one sheet per # heading, ## kept in the body, X/X folded', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, 'fixtures/taxo-synthetic');
    const markdown = await readFile(path.join(root, 'raw/untracked/X/X/guide.md'), 'utf8');
    const expected = (await readFile(path.join(root, 'expected/prototype-dry-run.txt'), 'utf8'));
    // The fixture is the synchronized copy of the prototype archive kept at
    // the workspace root (`_tmp/taxo/`, outside this repository). Compare
    // against it only where it exists: a fresh clone or CI has the fixture
    // alone, and its absence is not a test failure.
    const prototypeArchive = path.resolve(here, '../../_tmp/taxo');
    if (existsSync(prototypeArchive)) {
      expect(await readFile(path.join(root, 'raw/untracked/X/X/guide.md'), 'utf8')).toBe(
        await readFile(path.join(prototypeArchive, 'synthetic/raw/untracked/X/X/guide.md'), 'utf8'),
      );
      expect(await readFile(path.join(root, 'raw/untracked/X/X/second.md'), 'utf8')).toBe(
        await readFile(path.join(prototypeArchive, 'synthetic/raw/untracked/X/X/second.md'), 'utf8'),
      );
      expect(expected).toBe(await readFile(path.join(prototypeArchive, 'expected/prototype-dry-run.txt'), 'utf8'));
    }
    expect(expected).toContain('2/2 file(s), 4 concept(s)');
    expect(expected).toContain('0 empty or title/link-only section(s) skipped');

    const sections = extractSectionSheets(markdown, 'Guide synthétique');
    expect(sections.map(({ title, parent }) => [title, parent])).toEqual([
      ['Guide synthétique', ''],
      ['Contexte', ''],
      ['Autre parent', ''],
    ]);
    expect(sections[1]!.body).toContain('## Même titre');
    expect(sections[1]!.body).toContain('### Courte');
    expect(sections[1]!.body).toContain('## Liens seuls');
    expect(sections[2]!.body).toContain('# Ceci est du code, pas un titre de section');
    const engineTargets = sections.map((section) =>
      sectionSheetPath('raw/ingested/X/X/guide.md', 'Guide synthétique', section.title)
        .replace('wiki/sources/', ''));
    const second = extractSectionSheets(
      await readFile(path.join(root, 'raw/untracked/X/X/second.md'), 'utf8'),
      'Document second',
    );
    engineTargets.push(sectionSheetPath('raw/ingested/X/X/second.md', 'Document second', second[0]!.title)
      .replace('wiki/sources/', ''));
    const prototypeTargets = [...expected.matchAll(/-> (.+\.md)$/gm)]
      .map((match) => match[1]!.replace(/^wiki\/sources\//, ''));
    expect(engineTargets).toEqual(prototypeTargets);

    const signature = 'prototype-prompt:model:en';
    const contexteHash = sheetContentHash(sections[1]!.body, signature);
    expect(exactSheetDuplicate(contexteHash, [
      { path: 'wiki/sources/x/guide/contexte.md', title: 'Contexte', contentHash: contexteHash },
    ])?.path).toBe('wiki/sources/x/guide/contexte.md');
  });

  it('keeps exact source ranges and ignores headings inside fences', () => {
    const content = [
      '---',
      'title: Document',
      '---',
      '# Introduction',
      'A sufficiently long introduction that should become a section sheet.',
      '## Details',
      'A sufficiently long details section that should remain attached.',
      '```md',
      '# not a heading',
      '```',
      '# Conclusion',
      'A sufficiently long conclusion that should become another section sheet.',
    ].join('\n');

    const sheets = extractSectionSheets(content, 'Document', {
      minSectionChars: 1,
      minContentChars: 20,
    });

    expect(sheets.map((sheet) => sheet.title)).toEqual(['Introduction', 'Conclusion']);
    expect(sheets[0]!.body).toContain('## Details');
    expect(sheets[0]!.body).toContain('# not a heading');
    expect(sheets[0]!.sourceRanges).toEqual([{ startLine: 4, endLine: 10 }]);
    expect(sheets[1]!.sourceRanges).toEqual([{ startLine: 11, endLine: 12 }]);
  });

  it('splits an oversized # section at its ## sub-headings, keeping exact ranges', () => {
    const lead = 'L'.repeat(300);
    const content = [
      '# Big',
      lead,
      '## Alpha',
      'A'.repeat(300),
      '## Beta',
      'B'.repeat(300),
    ].join('\n');

    const sheets = extractSectionSheets(content, 'Document', {
      maxSectionChars: 400,
      minSectionChars: 1,
      minContentChars: 1,
    });

    expect(sheets.map((sheet) => [sheet.title, sheet.parent])).toEqual([
      ['Alpha', 'Big'],
      ['Beta', 'Big'],
    ]);
    expect(sheets[0]!.body).toContain(lead);
    expect(sheets[0]!.sourceRanges).toEqual([{ startLine: 2, endLine: 4 }]);
    expect(sheets[1]!.sourceRanges).toEqual([{ startLine: 5, endLine: 6 }]);
  });

  it('keeps an oversized # section whole when it has no ## sub-heading', () => {
    const content = ['# Big', 'X'.repeat(500)].join('\n');
    const sheets = extractSectionSheets(content, 'Document', {
      maxSectionChars: 100,
      minSectionChars: 1,
      minContentChars: 1,
    });
    expect(sheets.map((sheet) => sheet.title)).toEqual(['Big']);
  });

  it('merges short sections while preserving all ranges', () => {
    const content = [
      '# Long',
      'This is a long section with enough substantive content to be retained.',
      '# Short',
      'tiny',
      '# Next',
      'This is another long section with enough substantive content to be retained.',
    ].join('\n');
    const sheets = extractSectionSheets(content, 'Document', {
      minSectionChars: 40,
      minContentChars: 1,
    });

    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.body).toContain('## Short');
    expect(sheets[0]!.sourceRanges).toEqual([
      { startLine: 1, endLine: 2 },
      { startLine: 3, endLine: 4 },
    ]);
  });

  it('creates TAXO paths and bounded identities from document and section labels', () => {
    expect(sectionSheetSubject('JUNO / Inventaire', '1. Réseau')).toBe('juno-inventaire-1-réseau');
    expect(sectionSheetPath(
      'raw/ingested/dirnc/document.md',
      'Document',
      'Réseau',
      2,
    )).toBe('wiki/sources/dirnc/document/reseau-2.md');
  });

  it('parses the TAXO Markdown header without leaking it into the fiche body', () => {
    const parsed = parseTaxoSheet([
      'Description: A faithful summary.',
      'Tags: #site #capacite',
      '',
      '# Réseau DIRAG',
      '',
      'Six unités restent disponibles.',
    ].join('\n'));
    expect(parsed).toEqual({
      description: 'A faithful summary.',
      tags: ['site', 'capacite'],
      body: '# Réseau DIRAG\n\nSix unités restent disponibles.',
    });
  });
});

describe('table-of-contents headings', () => {
  it('never turns an exported TOC macro into a section title', () => {
    const toc = '- [](#doc-) - [1. Objet et enjeux](#doc-1objet) - [2. Le modèle](#doc-2modele)';
    const intro = 'Date de synthèse : 3 août 2026. Trois documents projet décrivent le besoin.\n';
    const section = (title: string) => `## ${title}\n\n${'Contenu détaillé de la section, assez long pour compter. '.repeat(6)}\n`;
    const content = `# Synthèse\n\n${intro}\n# ${toc}\n\n# Annexe\n\n${intro}\n## ${toc}\n\n${section('1. Objet et enjeux')}\n${section('2. Le modèle')}`;

    const units = extractSectionSheets(content, 'Synthèse', { maxSectionChars: 200 });

    expect(units.map((unit) => unit.title)).not.toContainEqual(expect.stringContaining('](#'));
    expect(units.some((unit) => unit.body.includes('](#doc-'))).toBe(false);
    expect(units.map((unit) => unit.title)).toEqual(expect.arrayContaining(['Objet et enjeux', 'Le modèle']));
  });
});
