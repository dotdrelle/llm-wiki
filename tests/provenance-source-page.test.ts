import { readFileSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { stampSourcePageTitle, validateSourcePage } from '../src/provenance/sourcePage.ts';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/provenance-audit/wiki/sources');

describe('source page contract (lot 2)', () => {
  it('accepts a harmonized source page with anchored citations', () => {
    const content = readFileSync(path.join(FIXTURE, 'detailed-note.md'), 'utf8');
    const result = validateSourcePage(content);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an unanchored citation', () => {
    const content = readFileSync(path.join(FIXTURE, 'one-line-note.md'), 'utf8');
    const result = validateSourcePage(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'anchored-citation')).toBe(true);
  });

  it('rejects a page that merges several documents or cites a foreign one', () => {
    const content = [
      '---',
      'title: Merge',
      'subject: merge',
      'type: source',
      'sources:',
      '  - path: raw/ingested/a.md',
      '  - path: raw/ingested/b.md',
      '---',
      '',
      '# Merge',
      '',
      '## Résumé',
      '',
      'Deux documents.',
      '',
      '[src: raw/ingested/a.md#A]',
    ].join('\n');
    const result = validateSourcePage(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'single-source')).toBe(true);
  });

  it('seeds the document title over a promoted ## Résumé, keeping it as a section', () => {
    const content = [
      '---',
      'subject: rapport-annuel',
      'type: source',
      '---',
      '',
      '# Résumé', // normalizeGeneratedMarkdown promoted `## Résumé` to the H1
      '',
      'Portée.',
    ].join('\n');
    const stamped = stampSourcePageTitle(content, 'Rapport annuel 2025');
    const { data, content: body } = matter(stamped);
    expect(data.title).toBe('Rapport annuel 2025');
    expect(body).toContain('# Rapport annuel 2025');
    expect(body).toContain('## Résumé');
    expect(body).not.toMatch(/^# Résumé/m);
  });

  it('replaces the taxo placeholder heading with the document title', () => {
    const content = [
      '---',
      'type: source',
      '---',
      '',
      '# Source note',
      '',
      '- Heading — fact',
    ].join('\n');
    const stamped = stampSourcePageTitle(content, 'Note de cadrage');
    const { data, content: body } = matter(stamped);
    expect(data.title).toBe('Note de cadrage');
    expect(body).toContain('# Note de cadrage');
    expect(body).not.toContain('# Source note');
  });

  it('keeps a real H1 the model chose and only completes the frontmatter', () => {
    const content = ['---', 'type: source', '---', '', '# Mon titre', '', '## Analyse'].join('\n');
    const stamped = stampSourcePageTitle(content, 'Titre du fichier');
    const { data, content: body } = matter(stamped);
    expect(data.title).toBe('Titre du fichier');
    expect(body).toContain('# Mon titre');
  });

  it('is idempotent', () => {
    const content = ['---', 'type: source', '---', '', '# Résumé', '', 'Portée.'].join('\n');
    const once = stampSourcePageTitle(content, 'Doc');
    expect(stampSourcePageTitle(once, 'Doc')).toBe(once);
  });

  it('rejects a factual section with no citation', () => {
    const content = [
      '---',
      'title: T',
      'subject: t',
      'type: source',
      'sources:',
      '  - path: raw/ingested/t.md',
      '---',
      '',
      '# T',
      '',
      '## Analyse',
      '',
      'Une affirmation sans preuve.',
    ].join('\n');
    const result = validateSourcePage(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'uncited-section')).toBe(true);
  });
});
