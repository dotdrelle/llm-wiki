import { describe, expect, it } from 'vitest';
import { reanchorToPreviousConcepts } from '../src/ingest/consolidationValidate.ts';
import type { ConsolidationPlan, ConsolidatedPage } from '../src/ingest/consolidationSchema.ts';

function plan(over: Partial<ConsolidationPlan> = {}): ConsolidationPlan {
  return {
    summary: 'test',
    operations: [],
    pages: [],
    ...over,
  };
}

function page(over: Partial<ConsolidatedPage> = {}): ConsolidatedPage {
  return {
    path: 'wiki/concepts/prophix.md',
    subject: 'prophix',
    collection: null,
    scope: 'product',
    kind: 'product',
    rationale: null,
    ...over,
  };
}

function previous(path: string, subject: string | null, content: string): { path: string; subject: string | null; content: string } {
  return { path, subject, content };
}

const PROPHIX_BODY = 'Prophix is an EPM platform for planning, budgeting and consolidation for finance teams.';

describe('reanchorToPreviousConcepts (§6.3, §12.2)', () => {
  it('rewrites a new concept create into an update of the previous page (exact subject)', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/prophix.md', content: `# Prophix\n\n${PROPHIX_BODY}` },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/prophix-one.md', 'prophix', PROPHIX_BODY)],
    );

    expect(result.operations[0]).toEqual({
      type: 'update',
      path: 'wiki/concepts/prophix-one.md',
      content: `# Prophix\n\n${PROPHIX_BODY}`,
    });
    expect(result.pages).toEqual([page({ path: 'wiki/concepts/prophix-one.md' })]);
  });

  it('re-anchors on content overlap even when the subject was renamed', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/prophix.md', content: `# Prophix\n\n${PROPHIX_BODY}` },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/prophix-one.md', 'prophix-one', `# Prophix One\n\n${PROPHIX_BODY}`)],
    );

    expect(result.operations[0]).toEqual({
      type: 'update',
      path: 'wiki/concepts/prophix-one.md',
      content: `# Prophix\n\n${PROPHIX_BODY}`,
    });
    expect(result.pages).toEqual([page({ path: 'wiki/concepts/prophix-one.md', subject: 'prophix-one' })]);
  });

  it('does not re-anchor a genuinely different product', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/board.md', content: '# Board\n\nBoard is a business intelligence toolkit for dashboards and analytics.' },
        ],
        pages: [page({ path: 'wiki/concepts/board.md', subject: 'board' })],
      }),
      [previous('wiki/concepts/prophix-one.md', 'prophix-one', `# Prophix One\n\n${PROPHIX_BODY}`)],
    );

    expect(result.operations[0]).toEqual({
      type: 'create',
      path: 'wiki/concepts/board.md',
      content: '# Board\n\nBoard is a business intelligence toolkit for dashboards and analytics.',
    });
  });

  it('does not touch a previous page the plan already targets', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'update', path: 'wiki/concepts/prophix-one.md', content: '# Updated' },
          { type: 'create', path: 'wiki/concepts/prophix.md', content: '# New' },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/prophix-one.md', 'prophix-one', PROPHIX_BODY)],
    );

    expect(result.operations.map((op) => op.path)).toEqual([
      'wiki/concepts/prophix-one.md',
      'wiki/concepts/prophix.md',
    ]);
  });

  it('normalizes the subject before comparing', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [{ type: 'create', path: 'wiki/concepts/prophix.md', content: '# X' }],
        pages: [page({ subject: 'Prophix (SAAS)' })],
      }),
      [previous('wiki/concepts/prophix-saas.md', 'prophix-saas', 'Prophix SAAS')],
    );

    expect(result.operations[0]).toEqual({ type: 'update', path: 'wiki/concepts/prophix-saas.md', content: '# X' });
  });

  it('returns the plan unchanged when there are no previous concepts', () => {
    const original = plan({
      operations: [{ type: 'create', path: 'wiki/concepts/a.md', content: '# A' }],
      pages: [page({ path: 'wiki/concepts/a.md', subject: 'a' })],
    });
    expect(reanchorToPreviousConcepts(original, [])).toBe(original);
  });
});
