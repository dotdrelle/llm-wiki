import { readFileSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { findUncitedFactualSections, stampSourcePageTitle, validateSourcePage } from '../src/provenance/sourcePage.ts';

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
    expect(data.subject).toBe('rapport-annuel-2025');
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

  it('strips markdown emphasis from the document title it seeds', () => {
    const content = ['---', 'type: source', '---', '', '# Source note', '', 'Contenu.'].join('\n');
    const stamped = stampSourcePageTitle(content, '**DIRAG (10/09/2026)**');
    const { data, content: body } = matter(stamped);
    expect(data.title).toBe('DIRAG (10/09/2026)');
    expect(body).toContain('# DIRAG (10/09/2026)');
    expect(body).not.toContain('**');
  });

  it('replaces a model-guessed source subject with the document identity', () => {
    const content = [
      '---',
      'subject: modele-comptable',
      'type: source',
      '---',
      '',
      '# Résumé',
      '',
      'Portée.',
    ].join('\n');
    const stamped = stampSourcePageTitle(content, 'Synthèse de la demande fonctionnelle');
    expect(matter(stamped).data.subject).toBe('synthèse-de-la-demande-fonctionnelle');
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

  it('accepts a TAXO fiche with merged subsections covered by its final anchored citation', () => {
    const content = [
      '---',
      'title: Raccordement réseau',
      'subject: guide-msi-réseau',
      'type: source',
      'input_hash: abc123',
      'generated:',
      '  by: llm-wiki',
      'sources:',
      '  - path: raw/ingested/msi/guide.md',
      '---',
      '',
      '# Raccordement réseau',
      '',
      '## A',
      '',
      'Première partie factuelle de la fiche.',
      '',
      '## B',
      '',
      'Deuxième partie factuelle de la même fiche.',
      '',
      '[src: raw/ingested/msi/guide.md#L4-12@sha256=' + 'a'.repeat(64) + ']',
    ].join('\n');
    expect(validateSourcePage(content)).toEqual({ ok: true, issues: [] });
    expect(matter(stampSourcePageTitle(content, 'Guide MSI')).data.subject).toBe('guide-msi-réseau');
  });

  it('detects uncited concept sections even when another section has a citation', () => {
    const content = [
      '# Concept',
      '',
      '## Appuyé',
      '',
      'Fait documenté. [src: raw/ingested/a.md#preuve]',
      '',
      '## Sans preuve',
      '',
      'Affirmation non citée.',
    ].join('\n');
    expect(findUncitedFactualSections(content)).toEqual(['Sans preuve']);
  });

  it('does not allow a factual concept body without headings to bypass citation checks', () => {
    expect(findUncitedFactualSections('Un fait sans titre ni citation.')).toEqual(['(document body)']);
  });
});
