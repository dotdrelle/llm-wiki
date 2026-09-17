import { describe, expect, it } from 'vitest';
import { validateConsolidation } from '../src/ingest/consolidationValidate.ts';
import { parseConceptPagePath } from '../src/ingest/conceptGrid.ts';
import type { ConsolidationPlan, ConsolidatedPage } from '../src/ingest/consolidationSchema.ts';

function plan(over: Partial<ConsolidationPlan> = {}): ConsolidationPlan {
  return { summary: 't', operations: [], pages: [], ...over };
}

function page(over: Partial<ConsolidatedPage> = {}): ConsolidatedPage {
  return {
    path: 'wiki/concepts/market-offering/beta.md',
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

function tagsFor(pages: ConsolidatedPage[], path = 'wiki/concepts/market-offering/beta.md'): string[] {
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
          { type: 'create', path: 'wiki/concepts/market-offering/beta-saas.md', content: '# X\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [page({ path: 'wiki/concepts/market-offering/beta-saas.md', subject: 'beta-saas' })],
      }),
      CTX,
    );
    expect(result.provenanceByPath.get('wiki/concepts/market-offering/beta-saas.md')?.tags).toEqual(['beta', 'product']);
  });

  it('n’ajoute rien quand il y a déjà au moins deux tags', () => {
    expect(tagsFor([page({ tags: ['beta', 'cloud'] })])).toEqual(['beta', 'cloud']);
  });
});

describe('parseConceptPagePath on a taxo leaf (<concept>_<resume>.md)', () => {
  it('parses instead of returning null, normalizing the underscore the same way folder names are', () => {
    expect(parseConceptPagePath('wiki/concepts/jedox/jedox_tarifs.md'))
      .toEqual({ class: 'jedox', subject: 'jedox-tarifs' });
  });
  it('still validates a classic path exactly as before (no normalization needed, no change)', () => {
    expect(parseConceptPagePath('wiki/concepts/market-offering/beta-saas.md'))
      .toEqual({ class: 'market-offering', subject: 'beta-saas' });
  });
  it('still rejects a genuinely malformed path (not just a taxo underscore)', () => {
    expect(parseConceptPagePath('wiki/concepts/jedox/Has Spaces.md')).toBeNull();
    expect(parseConceptPagePath('wiki/concepts/jedox.md')).toBeNull();
  });
});

describe('validateConsolidation reconciles a taxo-shaped leaf against its path', () => {
  it('derives the subject from the path when the plan omits it (no longer skipped for taxo leaves)', () => {
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: 'wiki/concepts/jedox/jedox_tarifs.md', content: '# X\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [],
      }),
      CTX,
    );
    expect(result.errors).toEqual([]);
    expect(result.provenanceByPath.get('wiki/concepts/jedox/jedox_tarifs.md')?.subject).toBe('jedox-tarifs');
  });
  it('flags (and corrects to the path) a declared subject that disagrees with a taxo path', () => {
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: 'wiki/concepts/jedox/jedox_tarifs.md', content: '# X\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [page({ path: 'wiki/concepts/jedox/jedox_tarifs.md', subject: 'wrong-subject' })],
      }),
      CTX,
    );
    expect(result.warnings.some((w) => w.path === 'wiki/concepts/jedox/jedox_tarifs.md'
      && w.reason.includes('contradicts the path'))).toBe(true);
    expect(result.provenanceByPath.get('wiki/concepts/jedox/jedox_tarifs.md')?.subject).toBe('jedox-tarifs');
  });
});

describe('validateConsolidation re-files a concept leaf with no concept folder', () => {
  it('moves a flat wiki/concepts/<subject>.md into the reserved unclassified/ folder', () => {
    // A declared subject used to rescue a path the folder model cannot place:
    // the leaf passed validation and landed at the concepts root, outside every
    // concept. Rather than reject the whole source, the engine files it where a
    // subject that fits no concept already waits.
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: 'wiki/concepts/acpi.md', content: '# ACPI\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [page({ path: 'wiki/concepts/acpi.md', subject: 'acpi' })],
      }),
      CTX,
    );
    const at = 'wiki/concepts/unclassified/acpi.md';
    expect(result.errors).toEqual([]);
    expect(result.operations.some((operation) => operation.path === at)).toBe(true);
    expect(result.operations.some((operation) => operation.path === 'wiki/concepts/acpi.md')).toBe(false);
    expect(result.provenanceByPath.get(at)?.subject).toBe('acpi');
    expect(result.warnings.some((warning) => warning.path === 'wiki/concepts/acpi.md'
      && warning.reason.includes('re-filed under unclassified/'))).toBe(true);
  });

  it('derives the subject from the basename and normalizes it', () => {
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: 'wiki/concepts/Souveraineté Numérique.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [],
      }),
      CTX,
    );
    expect(result.provenanceByPath.get('wiki/concepts/unclassified/souverainete-numerique.md')?.subject)
      .toBe('souverainete-numerique');
  });
});

describe('create vs update (validateConsolidation)', () => {
  it('turns a concept create into an update when the page already exists', () => {
    const at = 'wiki/concepts/market-offering/beta.md';
    const result = validateConsolidation(
      plan({
        operations: [
          { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\nBody. [src: raw/ingested/s.md]' },
          { type: 'create', path: at, content: '# X\n\nBody. [src: raw/ingested/s.md]' },
        ],
        pages: [page()],
      }),
      { ...CTX, existingPaths: new Set([at]) },
    );
    const operation = result.operations.find((item) => item.path === at);
    expect(operation?.type).toBe('update');
    expect(result.warnings.some((w) => w.path === at && /already exists/.test(w.reason))).toBe(true);
  });
});
