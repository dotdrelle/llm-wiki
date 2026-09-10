import { describe, expect, it } from 'vitest';
import {
  buildTaxoTable,
  splitIntoSections,
  taxoKindForSchema,
  taxoLeafContent,
  taxoLeafPath,
  taxoPlanForSource,
  type TaxoConcept,
  type TaxoRow,
} from '../src/ingest/taxoConsolidation.ts';

describe('splitIntoSections', () => {
  it('splits on # headings only, with line locators, and drops short bodies', () => {
    const sections = splitIntoSections([
      '---',
      'title: x',
      '---',
      '# Intro',
      'intro body long enough to pass the forty character minimum filter applied here.',
      '# Premier concept',
      'Le corps de la première section, assez long pour être gardé.',
      '## Sous-titre ignoré',
      'Encore du contenu sous un titre de niveau deux.',
      '# Deuxième',
      'Second body also long enough to be kept by the filter.',
    ].join('\n'));

    expect(sections.map((section) => section.heading)).toEqual(['Intro', 'Premier concept', 'Deuxième']);
    expect(sections[1]!.locator).toBeTruthy();
    expect(sections[1]!.body).toContain('Sous-titre ignoré');
  });
});

describe('taxo plan mapping', () => {
  const concepts: TaxoConcept[] = [{
    name: 'jedox',
    label: 'Jedox',
    kind: 'product',
    scope: 'product',
    definition: 'Progiciel EPM.',
    tags: ['solution', 'cout'],
    covers: [1, 2],
  }];
  const rows: TaxoRow[] = [
    { row: 1, source: 'a.md', heading: 'Premier concept', locator: '6-9', concept: 'jedox', resume: 'solution-no-code', facts: 'Jedox permet le no-code.' },
    { row: 2, source: 'a.md', heading: 'Deuxième', locator: '11-12', concept: 'jedox', resume: 'tarifs', facts: 'Tarifs SaaS.' },
  ];

  it('writes one leaf per row under the concept folder, plus the source note', () => {
    const plan = taxoPlanForSource(rows, concepts, 'wiki/sources/a.md', '2026-01-01T00:00:00.000Z');

    expect(plan.operations.map((operation) => operation.path)).toEqual([
      'wiki/concepts/jedox/jedox_solution-no-code.md',
      'wiki/concepts/jedox/jedox_tarifs.md',
      'wiki/sources/a.md',
    ]);
    expect(plan.pages).toHaveLength(3);
    expect(plan.pages[0]!.kind).toBe('product');
    expect(plan.pages[0]!.tags).toEqual(['solution', 'cout']);
    expect(plan.pages[0]!.rationale).toBe('Progiciel EPM.');
    expect(plan.pages[2]!.path).toBe('wiki/sources/a.md');
    expect(plan.pages[2]!.scope).toBe('source');
  });

  it('writes the OKF frontmatter with title, subject, locator and shared tags', () => {
    const content = taxoLeafContent(rows[0]!, concepts[0]!, '2026-01-01T00:00:00.000Z');
    expect(content).toContain('title: Jedox — solution no code');
    expect(content).toContain('type: product');
    expect(content).toContain('subject: solution-no-code');
    expect(content).toContain('tags: [solution, cout]');
    expect(content).toContain('status: draft');
    expect(content).toContain('locator: { heading: "Premier concept", lines: "6-9" }');
    expect(content).toContain('[src: raw/ingested/a.md]');
  });

  it('clamps the wide taxo kind vocabulary onto the closed extraction contract', () => {
    expect(taxoKindForSchema('tool')).toBe('product');
    expect(taxoKindForSchema('domain')).toBeNull();
    expect(taxoKindForSchema('decision')).toBeNull();
    expect(taxoKindForSchema('dimension')).toBe('dimension');
  });
});

describe('taxo leaf path', () => {
  it('is the concept folder plus <concept>_<resume>.md, normalized', () => {
    expect(taxoLeafPath('jedox', 'Solution No-Code')).toBe('wiki/concepts/jedox/jedox_solution-no-code.md');
  });
});

describe('taxo table', () => {
  it('numbers the rows and carries the facts', () => {
    const table = buildTaxoTable([
      { row: 1, source: 'a.md', heading: 'x', locator: '1-2', concept: 'jedox', resume: 'tarifs', facts: 'Tarifs SaaS.' },
    ]);
    expect(table).toContain('1. concept="jedox" resume="tarifs" | Tarifs SaaS.');
  });
});
