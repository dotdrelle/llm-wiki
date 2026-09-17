import { describe, expect, it, vi } from 'vitest';
import {
  collectConceptFolderEntries,
  conceptFolderMigrationOperations,
  normalizeConceptFolderName,
  reconcileConceptFolders,
} from '../src/ingest/conceptFolders.ts';
import type { WikiPage } from '../src/types.ts';

const ctx = { language: 'fr', runDate: '2026-09-17' };

function logger() {
  return { warn: vi.fn(async () => {}), info: vi.fn(async () => {}) } as never;
}

function page(relativePath: string, content: string): WikiPage {
  return {
    absolutePath: `/tmp/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    type: 'concept',
    content,
  };
}

function fakeLlm(folders: Array<{ folder: string; canonical: string }>) {
  return {
    completeJson: async () => ({ folders }),
  } as never;
}

describe('normalizeConceptFolderName', () => {
  it('slugifies to lowercase ASCII kebab-case', () => {
    expect(normalizeConceptFolderName('Produit Écrit')).toBe('produit-ecrit');
    expect(normalizeConceptFolderName('  Solution / Logicielle ')).toBe('solution-logicielle');
  });

  it('rejects an empty or oversized name rather than writing it', () => {
    expect(normalizeConceptFolderName('   ')).toBeNull();
    expect(normalizeConceptFolderName('a'.repeat(60))).toBeNull();
  });
});

describe('collectConceptFolderEntries', () => {
  it('groups by folder, sampling the subjects and tags each one holds', () => {
    const entries = collectConceptFolderEntries([
      page('wiki/concepts/produit/acpi.md', '---\nsubject: acpi\ntags: [outil, rgpd]\n---\n# ACPI\n'),
      page('wiki/concepts/produit/grist.md', '---\nsubject: grist\ntags: [outil]\n---\n# Grist\n'),
      page('wiki/concepts/exigence/secnum.md', '---\nsubject: secnum\ntags: [securite]\n---\n# SecNum\n'),
    ]);
    expect(entries.find((entry) => entry.folder === 'produit')?.subjects.sort()).toEqual(['acpi', 'grist']);
    expect(entries.find((entry) => entry.folder === 'exigence')?.subjects).toEqual(['secnum']);
  });
});

describe('reconcileConceptFolders', () => {
  it('maps a proposed folder onto the established vocabulary', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'product', canonical: 'produit' },
        { folder: 'requirement', canonical: 'exigence' },
      ]),
      entries: [
        { folder: 'produit', subjects: ['acpi'], tags: ['outil'] },
        { folder: 'exigence', subjects: ['secnum'], tags: [] },
      ],
      proposed: ['product', 'requirement'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('product')).toBe('produit');
    expect(mapping.get('requirement')).toBe('exigence');
    expect(mapping.get('produit')).toBe('produit');
    expect(mapping.get('exigence')).toBe('exigence');
  });

  it('never dissolves an established folder, even when the model says to', async () => {
    // The ACPI collapse: the model returned `solution -> produit`, and the
    // engine moved every leaf of an established folder. An established folder
    // is the anchor — a proposed new folder may join it, it may not absorb it.
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'solution', canonical: 'produit' },
        { folder: 'nouveau', canonical: 'produit' },
      ]),
      entries: [
        { folder: 'produit', subjects: [], tags: [] },
        { folder: 'solution', subjects: ['anaplan'], tags: [] },
      ],
      // `solution` is established AND written into by this plan: still anchored.
      proposed: ['solution', 'nouveau'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('solution')).toBe('solution');
    expect(mapping.get('nouveau')).toBe('produit');
  });

  it('resolves a chain of renames to its fixpoint', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'a', canonical: 'b' },
        { folder: 'b', canonical: 'c' },
        { folder: 'c', canonical: 'c' },
      ]),
      entries: [],
      proposed: ['a', 'b', 'c'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('a')).toBe('c');
    expect(mapping.get('b')).toBe('c');
  });

  it('treats a cycle as no decision at all', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'a', canonical: 'b' },
        { folder: 'b', canonical: 'a' },
      ]),
      entries: [],
      proposed: ['a', 'b'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('a')).toBe('a');
    expect(mapping.get('b')).toBe('b');
  });

  it('falls back to identity when the model call fails, never on a guess', async () => {
    const warn = vi.fn(async () => {});
    const llm = {
      completeJson: async () => {
        throw new Error('provider down');
      },
    } as never;
    const mapping = await reconcileConceptFolders({
      llm,
      entries: [{ folder: 'produit', subjects: [], tags: [] }],
      proposed: ['product'],
      ctx,
      logger: { warn } as never,
    });
    expect(mapping.get('produit')).toBe('produit');
    expect(mapping.get('product')).toBe('product');
    expect(warn).toHaveBeenCalled();
  });
});

describe('conceptFolderMigrationOperations', () => {
  it('merges two same-subject leaves into the canonical folder and unions their sources', () => {
    const operations = conceptFolderMigrationOperations(
      [
        page('wiki/concepts/source-a/jedox.md', '---\nsubject: jedox\nsources:\n  - path: raw/ingested/one.md\n---\n# Jedox\n'),
        page('wiki/concepts/source-b/jedox.md', '---\nsubject: jedox\nsources:\n  - path: raw/ingested/two.md\n---\n# Jedox (sécurité)\n'),
      ],
      new Map([['source-a', 'produit'], ['source-b', 'produit']]),
    );
    const update = operations.find((operation) => operation.type === 'update' && operation.path === 'wiki/concepts/produit/jedox.md');
    expect(update).toBeTruthy();
    const content = (update as { content: string }).content;
    expect(content).toContain('raw/ingested/one.md');
    expect(content).toContain('raw/ingested/two.md');
    // Both bodies survive the merge — a re-file must not drop knowledge.
    expect(content).toContain('# Jedox');
    expect(content).toContain('# Jedox (sécurité)');
    expect(operations).toContainEqual({ type: 'delete', path: 'wiki/concepts/source-a/jedox.md' });
    expect(operations).toContainEqual({ type: 'delete', path: 'wiki/concepts/source-b/jedox.md' });
  });

  it('merges a migrating leaf with the leaf already at the target', () => {
    const operations = conceptFolderMigrationOperations(
      [
        page('wiki/concepts/produit/jedox.md', '---\nsubject: jedox\n---\n# Jedox (prix)\n'),
        page('wiki/concepts/solutions-externes/jedox.md', '---\nsubject: jedox\n---\n# Jedox (sécurité)\n'),
      ],
      new Map([['produit', 'produit'], ['solutions-externes', 'produit']]),
    );
    const update = operations.find((operation) => operation.type === 'update' && operation.path === 'wiki/concepts/produit/jedox.md');
    expect((update as { content: string }).content).toContain('# Jedox (prix)');
    expect((update as { content: string }).content).toContain('# Jedox (sécurité)');
    expect(operations).toContainEqual({ type: 'delete', path: 'wiki/concepts/solutions-externes/jedox.md' });
  });

  it('rebases the concept prefix of a taxo leaf (<concept>_<resume>.md)', () => {
    const operations = conceptFolderMigrationOperations(
      [page('wiki/concepts/old/old_tarifs.md', '---\nsubject: old-tarifs\n---\n# Tarifs\n')],
      new Map([['old', 'new']]),
    );
    expect(operations).toContainEqual({
      type: 'update',
      path: 'wiki/concepts/new/new_tarifs.md',
      content: '---\nsubject: old-tarifs\n---\n# Tarifs\n',
    });
    expect(operations).toContainEqual({ type: 'delete', path: 'wiki/concepts/old/old_tarifs.md' });
  });
});
