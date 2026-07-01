import { describe, expect, it } from 'vitest';
import {
  extractWikiLinks,
  normalizeGeneratedMarkdown,
  normalizeHeadingPathKey,
  normalizeSourceBody,
  parseTemplateInstructions,
  splitMarkdownSections,
  splitSourceSections,
} from '../src/utils/markdown.ts';

describe('markdown helpers', () => {
  it('parses instruction placeholders with heading context', () => {
    const content = [
      '# Brief',
      '',
      '## Summary',
      '[[INSTRUCTION: Summarize the documented facts.]]',
      '',
      '## Risks',
      '[[INSTRUCTION: List the gaps.]]',
    ].join('\n');

    const instructions = parseTemplateInstructions(content);
    expect(instructions).toHaveLength(2);
    expect(instructions[0].headingPath).toEqual(['Brief', 'Summary']);
    expect(instructions[1].headingPath).toEqual(['Brief', 'Risks']);
  });

  it('splits markdown sections by full heading path', () => {
    const document = splitMarkdownSections(
      [
        '---',
        'title: Brief',
        '---',
        'Intro.',
        '',
        '# Brief',
        '',
        '## A',
        '',
        '### Risques',
        '',
        'A risks.',
        '',
        '## B',
        '',
        '### Risques',
        '',
        'B risks.',
      ].join('\n'),
    );

    const keys = document.sections.map((section) =>
      normalizeHeadingPathKey(section.headingPath),
    );
    expect(document.frontmatter).toContain('title: Brief');
    expect(document.preamble).toBe('Intro.');
    expect(keys).toContain('brief > a > risques');
    expect(keys).toContain('brief > b > risques');
  });

  it('extracts wiki links with aliases', () => {
    const links = extractWikiLinks('See [[Claude Code|CC]] and [[Local-first]].');
    expect(links).toEqual(['Claude Code', 'Local-first']);
  });

  it('normalizes Confluence-style HTML before ingestion', () => {
    const source = [
      'Actualites\t<ul><li>Comite de suivi du 13 avril<ul><li>``<a href="/spaces/PROJ/pages/100000010/Synthese">Synthese en cours</a></li>``',
      '<li><span style="color:var(--ds-text,#172b4d);">Point de RDV le <time class="date-upcoming" datetime="2026-05-07">07 May 2026</time> <span class="status-macro">DONE</span></li>',
      '</ul>',
    ].join('');

    const normalized = normalizeSourceBody(source);

    expect(normalized).toContain('- Comite de suivi du 13 avril');
    expect(normalized).toContain(
      '[Synthese en cours](/spaces/PROJ/pages/100000010/Synthese)',
    );
    expect(normalized).toContain('07 May 2026');
    expect(normalized).toContain('DONE');
    expect(normalized).not.toMatch(/<\/?(ul|li|span|time|a)\b/i);
    expect(normalized).not.toContain('``<');
  });

  it('normalizes generated markdown for markdownlint basics', () => {
    const normalized = normalizeGeneratedMarkdown(
      [
        '---',
        'title: Test',
        '---',
        '# Title',
        'Intro<span> text</span>',
        '##Bad stays text',
        '## Section',
        '<div>Body<br>next</div>',
        '# Another title',
        '```html',
        '<span>kept in code</span>',
        '```',
      ].join('\n'),
    );

    expect(normalized).toContain('---\ntitle: Test\n---\n# Title\n\nIntro text');
    expect(normalized).toContain('\n\n## Section\n\nBody  next');
    expect(normalized).toContain('\n\n## Another title\n\n');
    expect(normalized).toContain('<span>kept in code</span>');
    expect(normalized).not.toContain('<div>');
    expect(normalized).not.toContain('<span> text</span>');
  });

  it('moves generated preamble after the first h1', () => {
    const normalized = normalizeGeneratedMarkdown(
      ['Context before title.', '', '# Title', '', 'Body.'].join('\n'),
    );

    expect(normalized).toBe('# Title\n\nContext before title.\n\nBody.\n');
  });

  it('adds a fallback h1 when generated markdown has no heading', () => {
    const normalized = normalizeGeneratedMarkdown('Body only.', 'source-note');

    expect(normalized).toBe('# source note\n\nBody only.\n');
  });

  it('splits large sources by h2 and prefixes the document title', () => {
    const sections = splitSourceSections(
      ['# Document', '', '## One', 'A'.repeat(30), '', '## Two', 'B'.repeat(30)].join(
        '\n',
      ),
      60,
    );

    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.length <= 60)).toBe(true);
    expect(sections[0]).toContain('# Document');
    expect(sections[0]).toContain('## One');
    expect(sections[1]).toContain('# Document');
    expect(sections[1]).toContain('## Two');
  });

  it('splits oversized h2 sections by h3 before truncating', () => {
    const sections = splitSourceSections(
      [
        '# Document',
        '',
        '## Big',
        '',
        '### A',
        'A'.repeat(35),
        '',
        '### B',
        'B'.repeat(35),
      ].join('\n'),
      70,
    );

    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.length <= 70)).toBe(true);
    expect(sections[0]).toContain('### A');
    expect(sections[1]).toContain('### B');
  });

  it('truncates only as a final fallback', () => {
    const sections = splitSourceSections(
      ['# Document', '', '## Huge', 'A'.repeat(120)].join('\n'),
      70,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].length).toBeLessThanOrEqual(70);
    expect(sections[0]).toContain('[section truncated]');
  });
});
