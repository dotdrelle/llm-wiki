import { describe, expect, it } from 'vitest';
import { validateConsolidation } from '../src/ingest/consolidationValidate.ts';
import type { ConsolidationPlan, ConsolidatedPage } from '../src/ingest/consolidationSchema.ts';

function plan(over: Partial<ConsolidationPlan> = {}): ConsolidationPlan {
  return { summary: 't', operations: [], pages: [], ...over };
}

function page(over: Partial<ConsolidatedPage> = {}): ConsolidatedPage {
  return {
    path: 'wiki/concepts/offre-marche/beta.md',
    subject: 'beta',
    scope: 'product',
    kind: 'product',
    tags: [],
    rationale: null,
    ...over,
  };
}

const CTX = {
  sourcePagePath: 'wiki/sources/s.md',
  citationPath: 'raw/ingested/s.md',
  existingPaths: new Set<string>(),
};

function tagsFor(pages: ConsolidatedPage[], path = 'wiki/concepts/offre-marche/beta.md'): string[] {
  const result = validateConsolidation(
    plan({
      operations: [
        { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
        { type: 'create', path, content: '# X\n\nBody. [src: raw/ingested/s.md]' },
      ],
      pages,
    }),
    CTX,
  );
  return result.provenanceByPath.get(path)?.tags ?? [];
}

describe('plancher des tags (validateConsolidation)', () => {
  it('ajoute le subject ET le type quand une feuille a moins de deux tags', () => {
    expect(tagsFor([page()])).toEqual(['beta', 'product']);
  });

  it('ajoute le type quand le subject est déjà le seul tag', () => {
    expect(tagsFor([page({ tags: ['beta'] })])).toEqual(['beta', 'product']);
  });

  it('ajoute le subject et le type quand un autre tag unique est présent', () => {
    expect(tagsFor([page({ tags: ['cloud'] })])).toEqual(['cloud', 'beta', 'product']);
  });

  it('utilise « concept » comme type quand la feuille n’a pas de kind', () => {
    expect(tagsFor([page({ kind: null })])).toEqual(['beta', 'concept']);
  });

  it('tronque le subject ajouté à son premier terme (split)', () => {
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: 'wiki/concepts/offre-marche/beta-saas.md', content: '# X\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [page({ path: 'wiki/concepts/offre-marche/beta-saas.md', subject: 'beta-saas' })],
      }),
      CTX,
    );
    expect(result.provenanceByPath.get('wiki/concepts/offre-marche/beta-saas.md')?.tags).toEqual(['beta', 'product']);
  });

  it('n’ajoute rien quand il y a déjà au moins deux tags', () => {
    expect(tagsFor([page({ tags: ['beta', 'cloud'] })])).toEqual(['beta', 'cloud']);
  });
});
