import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  taxoPlanForSource,
  taxoSheetContent,
  taxoSheetPath,
  taxoTagPageContent,
  type TaxoRow,
} from '../src/ingest/taxoConsolidation.ts';

function sheetRow(overrides: Partial<TaxoRow> = {}): TaxoRow {
  return {
    row: 1,
    source: 'raw/ingested/a.md',
    archivePath: 'raw/ingested/a.md',
    documentTitle: 'A',
    heading: 'Premier concept',
    locator: '1-2',
    facts: 'Le corps de la fiche.',
    description: 'Résumé fidèle.',
    tags: ['solution', 'cout'],
    inputHash: 'input-digest',
    citationAnchor: `L1-2@sha256=${'a'.repeat(64)}`,
    ...overrides,
  };
}

describe('taxo plan mapping', () => {
  it('writes one fiche per section under the source tree, without a compatibility source page', () => {
    const plan = taxoPlanForSource(
      [sheetRow(), sheetRow({ row: 2, heading: 'Deuxième' })],
      '2026-01-01T00:00:00.000Z',
    );

    expect(plan.operations.map((operation) => operation.path)).toEqual([
      'wiki/sources/a/premier-concept.md',
      'wiki/sources/a/deuxieme.md',
    ]);
    expect(plan.operations.some((operation) => operation.path === 'wiki/sources/a.md')).toBe(false);
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0]!.tags).toEqual(['solution', 'cout']);
    expect(plan.pages[0]!.rationale).toBe('Résumé fidèle.');
  });

  it('canonicalizes archive citations and gives each fiche a document-section subject', () => {
    const row = sheetRow({
      source: 'raw/untracked/MSI/MSI/guide.md',
      archivePath: 'raw/ingested/msi/guide.md',
      documentTitle: 'Guide MSI',
      heading: 'Réseau',
      contentHash: 'section-content-digest',
    });

    expect(taxoSheetPath(row)).toBe('wiki/sources/msi/guide/reseau.md');
    const content = taxoSheetContent(row, '2026-01-01T00:00:00.000Z');
    expect(content).toContain('subject: "guide-msi-réseau"');
    expect(content).toContain('content_hash: "section-content-digest"');
    expect(content).toContain(`[src: raw/ingested/msi/guide.md#L1-2@sha256=${'a'.repeat(64)}]`);
    expect(content).not.toContain('raw/untracked');
  });

  it('cites each disjoint source range of a fiche separately', () => {
    const row = sheetRow({
      source: 'raw/ingested/doc.md',
      archivePath: 'raw/ingested/doc.md',
      documentTitle: 'Document',
      heading: 'Synthèse',
      sourceRanges: [{ startLine: 4, endLine: 5 }, { startLine: 12, endLine: 13 }],
      citationAnchor: undefined,
      citationAnchors: [`L4-5@sha256=${'a'.repeat(64)}`, `L12-13@sha256=${'b'.repeat(64)}`],
    });
    const content = taxoSheetContent(row, '2026-01-01T00:00:00.000Z');
    expect(content).toContain(`[src: raw/ingested/doc.md#${row.citationAnchors![0]}]`);
    expect(content).toContain(`[src: raw/ingested/doc.md#${row.citationAnchors![1]}]`);
    expect(content).not.toContain('L4-13@sha256=');
  });

  it('drops a model-authored citation so only the anchored engine citation remains', () => {
    const row = sheetRow({ facts: 'Le corps garde [src: raw/ingested/a.md] cette mention.' });
    const content = taxoSheetContent(row, '2026-01-01T00:00:00.000Z');
    expect(content.match(/\[src:/g) ?? []).toHaveLength(1);
    expect(content).not.toContain('[src: raw/ingested/a.md]');
    expect(content).toContain(`[src: raw/ingested/a.md#L1-2@sha256=${'a'.repeat(64)}]`);
  });

  it('disambiguates two rows that would collide on the same fiche path', () => {
    const plan = taxoPlanForSource(
      [sheetRow(), sheetRow({ row: 2, facts: 'Second fait.' })],
      '2026-01-01T00:00:00.000Z',
    );
    expect(plan.operations.map((operation) => operation.path)).toEqual([
      'wiki/sources/a/premier-concept.md',
      'wiki/sources/a/premier-concept-2.md',
    ]);
  });
});

describe('tag-page source preview', () => {
  it('matches the synthetic lot-0 oracle for a generated family pivot', () => {
    const actual = taxoTagPageContent('réseau', 'Infrastructure', [
      { title: 'Fiche réseau', path: 'wiki/sources/guide/reseau.md', description: 'Gestion des échanges' },
    ], '2026-01-01T00:00:00.000Z', 'concept-fixture', 50, 'subject-fixture');
    const expected = readFileSync(new URL('./fixtures/taxo-synthetic/expected/tag-page-infrastructure.md', import.meta.url), 'utf8');
    expect(actual).toBe(expected);
  });

  it('limits visible fiche links without losing citation paths used by provenance derivation', () => {
    const content = taxoTagPageContent('réseau', 'Infrastructure', [
      { title: 'Première fiche', path: 'wiki/sources/a/one.md' },
      { title: 'Deuxième fiche', path: 'wiki/sources/b/two.md' },
    ], '2026-01-01T00:00:00.000Z', 'concept-1', 1);
    expect(content).toContain('**Première fiche**');
    expect(content).not.toContain('**Deuxième fiche**');
    expect(content).toContain('<!-- Additional generated pivot citations');
    expect(content).toContain('[src: wiki/sources/b/two.md]');
  });
});
