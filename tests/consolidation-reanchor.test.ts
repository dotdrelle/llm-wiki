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
    path: 'wiki/concepts/beta.md',
    subject: 'beta',
    scope: 'product',
    kind: 'product',
    tags: [],
    rationale: null,
    ...over,
  };
}

function previous(path: string, subject: string | null, content: string, cls: string | null = null): { path: string; subject: string | null; class: string | null; content: string } {
  return { path, subject, class: cls, content };
}

const BETA_BODY = 'Beta is an EPM platform for planning, budgeting and consolidation for finance teams.';

describe('reanchorToPreviousConcepts (§6.3, §12.2)', () => {
  it('rewrites a new concept create into an update of the previous page (exact subject)', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/beta.md', content: `# Beta\n\n${BETA_BODY}` },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/beta-one.md', 'beta', BETA_BODY)],
    );

    expect(result.operations[0]).toEqual({
      type: 'update',
      path: 'wiki/concepts/beta-one.md',
      content: `# Beta\n\n${BETA_BODY}`,
    });
    expect(result.pages).toEqual([page({ path: 'wiki/concepts/beta-one.md' })]);
  });

  it('re-anchors on content overlap even when the subject was renamed', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/beta.md', content: `# Beta\n\n${BETA_BODY}` },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/beta-one.md', 'beta-one', `# Beta One\n\n${BETA_BODY}`)],
    );

    expect(result.operations[0]).toEqual({
      type: 'update',
      path: 'wiki/concepts/beta-one.md',
      content: `# Beta\n\n${BETA_BODY}`,
    });
    expect(result.pages).toEqual([page({ path: 'wiki/concepts/beta-one.md', subject: 'beta-one' })]);
  });

  it('does not re-anchor a genuinely different product', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/epsilon.md', content: '# Epsilon\n\nBoard is a business intelligence toolkit for dashboards and analytics.' },
        ],
        pages: [page({ path: 'wiki/concepts/epsilon.md', subject: 'epsilon' })],
      }),
      [previous('wiki/concepts/beta-one.md', 'beta-one', `# Beta One\n\n${BETA_BODY}`)],
    );

    expect(result.operations[0]).toEqual({
      type: 'create',
      path: 'wiki/concepts/epsilon.md',
      content: '# Epsilon\n\nBoard is a business intelligence toolkit for dashboards and analytics.',
    });
  });

  it('does not touch a previous page the plan already targets', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'update', path: 'wiki/concepts/beta-one.md', content: '# Updated' },
          { type: 'create', path: 'wiki/concepts/beta.md', content: '# New' },
        ],
        pages: [page()],
      }),
      [previous('wiki/concepts/beta-one.md', 'beta-one', BETA_BODY)],
    );

    expect(result.operations.map((op) => op.path)).toEqual([
      'wiki/concepts/beta-one.md',
      'wiki/concepts/beta.md',
    ]);
  });

  it('normalizes the subject before comparing', () => {
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [{ type: 'create', path: 'wiki/concepts/beta.md', content: '# X' }],
        pages: [page({ subject: 'Beta (SAAS)' })],
      }),
      [previous('wiki/concepts/beta-saas.md', 'beta-saas', 'Beta SAAS')],
    );

    expect(result.operations[0]).toEqual({ type: 'update', path: 'wiki/concepts/beta-saas.md', content: '# X' });
  });

  it('returns the plan unchanged when there are no previous concepts', () => {
    const original = plan({
      operations: [{ type: 'create', path: 'wiki/concepts/a.md', content: '# A' }],
      pages: [page({ path: 'wiki/concepts/a.md', subject: 'a' })],
    });
    expect(reanchorToPreviousConcepts(original, [])).toBe(original);
  });

  it('ne ré-ancre pas deux feuilles sœurs (même sujet, classes différentes) l’une sur l’autre', () => {
    // Une feuille = un couple (classe × sujet). Deux feuilles de sujet « beta »
    // sous deux classes sont le modèle, pas un doublon : ré-ancrer l’une sur la
    // page de l’autre produirait un chemin dont la classe contredit la sienne.
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/offre-marche/beta.md', content: `# Beta\n\n${BETA_BODY}` },
          { type: 'create', path: 'wiki/concepts/securite/beta.md', content: `# Beta\n\n${BETA_BODY}` },
        ],
        pages: [
          page({ path: 'wiki/concepts/offre-marche/beta.md', subject: 'beta' }),
          page({ path: 'wiki/concepts/securite/beta.md', subject: 'beta' }),
        ],
      }),
      [
        previous('wiki/concepts/offre-marche/beta.md', 'beta', BETA_BODY, 'offre-marche'),
        previous('wiki/concepts/securite/beta.md', 'beta', BETA_BODY, 'securite'),
      ],
    );

    expect(result.operations.map((op) => op.path)).toEqual([
      'wiki/concepts/offre-marche/beta.md',
      'wiki/concepts/securite/beta.md',
    ]);
    expect(result.operations.every((op) => op.type === 'create')).toBe(true);
  });

  it('ne ré-ancre pas une feuille classée sur une ancienne page plate sans classe', () => {
    // Page d’avant la grille (`wiki/concepts/beta.md`, sans classe) : une
    // feuille nouvellement classée ne doit pas être ramenée sur ce chemin plat,
    // sinon `class` et chemin se contredisent.
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/offre-marche/beta.md', content: `# Beta\n\n${BETA_BODY}` },
        ],
        pages: [page({ path: 'wiki/concepts/offre-marche/beta.md', subject: 'beta' })],
      }),
      [previous('wiki/concepts/beta.md', 'beta', BETA_BODY)],
    );

    expect(result.operations[0]).toEqual({
      type: 'create',
      path: 'wiki/concepts/offre-marche/beta.md',
      content: `# Beta\n\n${BETA_BODY}`,
    });
  });

  it('déduit la classe du chemin quand le modèle omet le champ declared class', () => {
    // Le modèle nomme souvent la classe correctement dans le chemin et omet le
    // champ `class` — même repli que `detectConceptSplits`. Sans lui, la clé de
    // recherche retombe sur classe=null et ré-ancre à tort sur l’ancienne page
    // plate d’un autre sujet homonyme.
    const result = reanchorToPreviousConcepts(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/offre-marche/beta.md', content: `# Beta\n\n${BETA_BODY}` },
        ],
        pages: [page({ path: 'wiki/concepts/offre-marche/beta.md', subject: 'beta' })],
      }),
      [previous('wiki/concepts/beta.md', 'beta', BETA_BODY)],
    );

    expect(result.operations[0]).toEqual({
      type: 'create',
      path: 'wiki/concepts/offre-marche/beta.md',
      content: `# Beta\n\n${BETA_BODY}`,
    });
  });
});
