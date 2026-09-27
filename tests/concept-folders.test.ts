import { describe, expect, it, vi } from 'vitest';
import {
  collectConceptFolderEntries,
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

const conceptIdOne = '123e4567-e89b-42d3-a456-426614174000';
const conceptIdTwo = '223e4567-e89b-42d3-a456-426614174000';

function fakeLlm(folders: Array<{ folder: string; canonical: string; concept_id?: string }>) {
  return {
    completeJson: async () => ({ folders }),
  } as never;
}

describe('normalizeConceptFolderName', () => {
  it('normalizes Unicode labels without transliterating them', () => {
    expect(normalizeConceptFolderName('Produit Écrit')).toBe('produit-écrit');
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
  it('maps proposed labels by stable identity rather than a vocabulary table', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'new-label-one', canonical: 'ignored-label', concept_id: conceptIdOne },
        { folder: 'new-label-two', canonical: 'ignored-label', concept_id: conceptIdTwo },
      ]),
      entries: [
        { folder: 'established-label-one', conceptId: conceptIdOne, subjects: ['subject-one'], tags: ['tag-one'] },
        { folder: 'established-label-two', conceptId: conceptIdTwo, subjects: ['subject-two'], tags: [] },
      ],
      proposed: ['new-label-one', 'new-label-two'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('new-label-one')).toBe('established-label-one');
    expect(mapping.get('new-label-two')).toBe('established-label-two');
    expect(mapping.get('established-label-one')).toBe('established-label-one');
  });

  it('never dissolves an established folder, even when the model says to', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'established-two', canonical: 'established-one', concept_id: conceptIdOne },
        { folder: 'new-label', canonical: 'established-one', concept_id: conceptIdOne },
      ]),
      entries: [
        { folder: 'established-one', conceptId: conceptIdOne, subjects: [], tags: [] },
        { folder: 'established-two', conceptId: conceptIdTwo, subjects: ['subject-two'], tags: [] },
      ],
      // `established-two` is established AND written into by this plan: still anchored.
      proposed: ['established-two', 'new-label'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('established-two')).toBe('established-two');
    expect(mapping.get('new-label')).toBe('established-one');
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

// The migration pass that used to live here could not fire: an established
// folder is never a rename source, and every page on disk is by definition in
// an established folder. The tests that covered it hand-built a mapping the
// reconciliation cannot produce, so they were green on an impossible state.
// This is the invariant that made it dead code, pinned directly.
describe('reconcileConceptFolders leaves the leaves on disk alone', () => {
  it('maps every established folder onto itself, whatever the model answers', async () => {
    const mapping = await reconcileConceptFolders({
      llm: fakeLlm([
        { folder: 'new-label', canonical: 'ignored-label', concept_id: conceptIdOne },
        // The model tries to dissolve an established folder: refused.
        { folder: 'established-two', canonical: 'established-one', concept_id: conceptIdOne },
      ]),
      entries: [
        { folder: 'established-one', conceptId: conceptIdOne, subjects: ['subject-one'], tags: [] },
        { folder: 'established-two', conceptId: conceptIdTwo, subjects: ['subject-two'], tags: [] },
      ],
      proposed: ['new-label'],
      ctx,
      logger: logger(),
    });
    expect(mapping.get('new-label')).toBe('established-one');
    expect(mapping.get('established-one')).toBe('established-one');
    expect(mapping.get('established-two')).toBe('established-two');
  });
});
