import { describe, expect, it } from 'vitest';
import { validateConsolidation } from '../src/ingest/consolidationValidate.ts';
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

import { detectNearDuplicateFolders, folderNearKey, foldersAreNearDuplicates, folderWords } from '../src/ingest/consolidationValidate.ts';

describe('folder near-duplicates (singular/plural and hyphen refinements)', () => {
  it('flags a trailing-s plural of the same word', () => {
    expect(foldersAreNearDuplicates('product', 'products')).toBe(true);
    expect(foldersAreNearDuplicates('requirement', 'requirements')).toBe(true);
    expect(foldersAreNearDuplicates('serveur', 'serveurs')).toBe(true);
  });
  it('flags a hyphenated refinement of an existing folder (same first word)', () => {
    expect(foldersAreNearDuplicates('requirement', 'requirements-operations')).toBe(true);
    expect(foldersAreNearDuplicates('product', 'product-zephyr')).toBe(true);
    expect(foldersAreNearDuplicates('solution-suite', 'solutions-external')).toBe(true);
  });
  it('treats underscore spellings like hyphenated ones at the comparison level', () => {
    // Concept paths themselves reject '_' (isValidProvenanceValue); the
    // normalization matters for any value that reaches the comparison, so an
    // underscore twin of a hyphenated folder compares as the same name.
    expect(folderNearKey('requirements_operations')).toBe(folderNearKey('requirements-operations'));
    expect(folderWords(folderNearKey('requirements_operations'))).toEqual(
      folderWords(folderNearKey('requirements-operations')),
    );
  });
  it('leaves genuinely different concepts alone', () => {
    expect(foldersAreNearDuplicates('market-offering', 'solutions-market')).toBe(false);
    expect(foldersAreNearDuplicates('budget', 'infrastructure')).toBe(false);
    expect(foldersAreNearDuplicates('product', 'production')).toBe(false);
    expect(foldersAreNearDuplicates('projet', 'product')).toBe(false);
  });
  it('flags a curated synonym with no shared word at all ("produit" / "solution-logicielle")', () => {
    expect(foldersAreNearDuplicates('produit', 'solution-logicielle')).toBe(true);
    expect(foldersAreNearDuplicates('produit', 'solution')).toBe(true);
    expect(foldersAreNearDuplicates('logiciel', 'outil')).toBe(true);
    // Not a member of the curated group: stays a lexical-only comparison.
    expect(foldersAreNearDuplicates('produit', 'infrastructure')).toBe(false);
  });
  it('detects the conflict in a plan that would open a near-duplicate folder', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({
        operations: [
          { type: 'create', path: 'wiki/concepts/product-zephyr/certifications.md', content: '# x' },
          { type: 'create', path: 'wiki/concepts/requirements/outil.md', content: '# y' },
        ],
      }),
      { existingFolders: ['product', 'requirement', 'budget'] },
    );
    expect(conflicts.map((c) => `${c.proposedFolder}~${c.existingFolder}`)).toEqual([
      'product-zephyr~product',
      'requirements~requirement',
    ]);
  });
  it('leaves a leaf filed into an existing folder alone', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/product/nouveau.md', content: '# x' }] }),
      { existingFolders: ['product'] },
    );
    expect(conflicts).toEqual([]);
  });
  it('flags a NEW folder that near-duplicates an existing synonym ("vendor" doubling "produit")', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/vendor/jedox.md', content: '# x' }] }),
      { existingFolders: ['produit', 'exigence'] },
    );
    expect(conflicts).toEqual([{ path: 'wiki/concepts/vendor/jedox.md', proposedFolder: 'vendor', existingFolder: 'produit' }]);
  });
  it('flags an OLD split still on disk: two near-duplicate folders that both already exist', () => {
    // A workspace ingested before FOLDER_SYNONYM_GROUPS covered "solution-logicielle"
    // (or before the check existed) can carry both folders already. Picking
    // either looks correct in isolation, so this must be caught even though
    // the chosen folder is itself already in existingFolders.
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/solution-logicielle/pigment.md', content: '# x' }] }),
      { existingFolders: ['produit', 'solution-logicielle'] },
    );
    expect(conflicts).toEqual([{
      path: 'wiki/concepts/solution-logicielle/pigment.md',
      proposedFolder: 'solution-logicielle',
      existingFolder: 'produit',
    }]);
  });
  it('does not complain when the model picks the canonical (alphabetically-first) side of an old split', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/produit/pigment.md', content: '# x' }] }),
      { existingFolders: ['produit', 'solution-logicielle'] },
    );
    expect(conflicts).toEqual([]);
  });
});
