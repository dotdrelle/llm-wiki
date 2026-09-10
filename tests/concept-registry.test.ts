import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { folderNamingIssues, listConceptRegistry } from '../src/ingest/conceptRegistry.ts';
import { loadConceptSynonymGroups } from '../src/ingest/conceptSynonyms.ts';

function withWorkspace(fn: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'wiki-registry-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('concept registry', () => {
  it('reports leaf counts, tags, naming violations and near-duplicate families', () => {
    withWorkspace((root) => {
      mkdirSync(path.join(root, 'wiki', 'concepts', 'produit'), { recursive: true });
      mkdirSync(path.join(root, 'wiki', 'concepts', 'produits'), { recursive: true });
      mkdirSync(path.join(root, 'wiki', 'concepts', 'outil'), { recursive: true });
      writeFileSync(path.join(root, 'wiki', 'concepts', 'produit', 'acpi.md'), '---\ntags:\n  - cout\n  - donnees\n---\n# ACPI\n');
      writeFileSync(path.join(root, 'wiki', 'concepts', 'produits', 'anaplan.md'), '---\ntags:\n  - cout\n---\n# Anaplan\n');
      writeFileSync(path.join(root, 'wiki', 'concepts', 'outil', 'grille.md'), '---\n---\n# Grille\n');

      const registry = listConceptRegistry(root);

      expect(registry.entries.map((entry) => entry.folder)).toEqual(['outil', 'produit', 'produits']);
      const produits = registry.entries.find((entry) => entry.folder === 'produits')!;
      expect(produits.leaves).toBe(1);
      expect(produits.namingIssues).toContain('plural');
      const produit = registry.entries.find((entry) => entry.folder === 'produit')!;
      expect(produit.tags).toContain('cout');
      expect(registry.nearDuplicates).toEqual([
        { left: 'outil', right: 'produit' },
        { left: 'produit', right: 'produits' },
      ]);
      expect(registry.synonymErrors).toEqual([]);
    });
  });

  it('loads a workspace synonym file on top of the built-in groups', () => {
    withWorkspace((root) => {
      mkdirSync(path.join(root, '.wiki'), { recursive: true });
      writeFileSync(path.join(root, '.wiki', 'concept-synonyms.yaml'),
        'groups:\n  - [exigence, cahier-des-charges]\n  - [tarif, prix]\n');

      const { groups, errors } = loadConceptSynonymGroups(root);

      expect(errors).toEqual([]);
      expect(groups.some((group) => group.includes('produit') && group.includes('solution-logicielle'))).toBe(true);
      expect(groups.some((group) => group.includes('exigence') && group.includes('cahier-des-charges'))).toBe(true);
    });
  });

  it('reports an unreadable or malformed synonym file without breaking the registry', () => {
    withWorkspace((root) => {
      mkdirSync(path.join(root, '.wiki'), { recursive: true });
      writeFileSync(path.join(root, '.wiki', 'concept-synonyms.yaml'), 'groups:\n  - solo\n  - [a, a]\n');

      const { groups, errors } = loadConceptSynonymGroups(root);

      expect(groups.length).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('folder naming', () => {
  it('flags plural, non-kebab, non-ascii and malformed names', () => {
    expect(folderNamingIssues('produit')).toEqual([]);
    expect(folderNamingIssues('produits')).toContain('plural');
    expect(folderNamingIssues('knowledge base')).toContain('not kebab-case');
    expect(folderNamingIssues('éxigence')).toContain('non-ascii');
    expect(folderNamingIssues('exigence--meteo')).toContain('malformed dashes');
  });
});
