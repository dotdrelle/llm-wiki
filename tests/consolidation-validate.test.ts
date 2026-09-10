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
  it('composes the kind-derived synonym match with singular/plural', () => {
    // A plural spelling of a recognized word must still resolve to its kind.
    expect(foldersAreNearDuplicates('produits', 'solution-logicielle')).toBe(true);
    expect(foldersAreNearDuplicates('produit', 'outils')).toBe(true);
    expect(foldersAreNearDuplicates('fournisseurs', 'editeur')).toBe(true);
  });
  it('keeps "vendor" and "produit" separate — a vendor is not its product', () => {
    // extractionSchema.ts's KIND_SYNONYMS deliberately keeps these two kinds
    // apart everywhere else in the pipeline; folder-equivalence, now derived
    // from that same vocabulary, must not contradict it.
    expect(foldersAreNearDuplicates('vendor', 'produit')).toBe(false);
    expect(foldersAreNearDuplicates('fournisseur', 'solution-logicielle')).toBe(false);
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
  it('flags a NEW folder that near-duplicates an existing kind-derived synonym ("editeur" doubling "vendor")', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/editeur/jedox.md', content: '# x' }] }),
      { existingFolders: ['vendor', 'exigence'] },
    );
    expect(conflicts).toEqual([{ path: 'wiki/concepts/editeur/jedox.md', proposedFolder: 'editeur', existingFolder: 'vendor' }]);
  });
  it('does NOT flag "vendor" as a near-duplicate of an existing "produit" — different kinds', () => {
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/vendor/jedox.md', content: '# x' }] }),
      { existingFolders: ['produit', 'exigence'] },
    );
    expect(conflicts).toEqual([]);
  });
  it('flags an OLD split still on disk: two near-duplicate folders that both already exist', () => {
    // A workspace ingested before this check existed (or before a synonym
    // was recognized) can carry both folders already. Picking either looks
    // correct in isolation, so this must be caught even though the chosen
    // folder is itself already in existingFolders.
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
  it('prefers the EXPLICIT canonical name over alphabetical order', () => {
    // "application" sorts before "produit" — a purely alphabetical tie-break
    // would wrongly steer towards "application" here. CANONICAL_FOLDER_BY_KIND
    // says "produit" is the declared canonical for the product kind, and that
    // must win regardless of string order.
    const conflicts = detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/application/pigment.md', content: '# x' }] }),
      { existingFolders: ['application', 'produit'] },
    );
    expect(conflicts).toEqual([{
      path: 'wiki/concepts/application/pigment.md',
      proposedFolder: 'application',
      existingFolder: 'produit',
    }]);
    // And the reverse: picking "produit" (the declared canonical) itself
    // never triggers a conflict against its own sibling.
    expect(detectNearDuplicateFolders(
      plan({ operations: [{ type: 'create', path: 'wiki/concepts/produit/pigment.md', content: '# x' }] }),
      { existingFolders: ['application', 'produit'] },
    )).toEqual([]);
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
