import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSourcePage } from '../src/provenance/sourcePage.ts';

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
