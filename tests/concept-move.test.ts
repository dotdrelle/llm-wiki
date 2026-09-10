import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decideConceptMove } from '../src/serve/tree/conceptMove.ts';
import { moveEntry } from '../src/serve/tree/treeMutations.ts';

/*
 Re-filing a concept leaf by hand.

 The concept is the FOLDER, never a frontmatter field. A move under
 `wiki/concepts/` re-files the leaf into the destination folder, rewrites the
 `subject` when the file name changed, and repoints the inbound links.
*/

describe('decideConceptMove', () => {
  it('ignores a move that touches nothing under wiki/concepts', () => {
    expect(decideConceptMove({ from: 'wiki/sources/a.md', to: 'wiki/sources/b/a.md', isFile: true }))
      .toEqual({ kind: 'ignore' });
  });

  it('re-files a leaf dragged out of unclassified into a concept folder', () => {
    expect(decideConceptMove({
      from: 'wiki/concepts/unclassified/zephyr.md',
      to: 'wiki/concepts/market-offering/zephyr.md',
      isFile: true,
    })).toEqual({ kind: 'refile', className: 'market-offering', subject: 'zephyr' });
  });

  it('refuses a leaf dropped straight under wiki/concepts, with no concept folder', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/zephyr.md',
      to: 'wiki/concepts/zephyr.md',
      isFile: true,
    });
    expect(decision.kind).toBe('reject');
  });

  it('refuses to move a whole concept folder', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/market-offering',
      to: 'wiki/concepts/security-sovereignty/market-offering',
      isFile: false,
    });
    expect(decision.kind).toBe('reject');
  });

  it('renames a <concept>_<resume>.md leaf to the new concept on the move', () => {
    expect(decideConceptMove({
      from: 'wiki/concepts/jedox/jedox_tarifs.md',
      to: 'wiki/concepts/produit/jedox_tarifs.md',
      isFile: true,
    })).toEqual({
      kind: 'refile',
      className: 'produit',
      subject: 'tarifs',
      target: 'wiki/concepts/produit/produit_tarifs.md',
    });
  });

  it('keeps the plain name for a leaf that does not carry its concept in the file name', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/zephyr.md',
      to: 'wiki/concepts/market-offering/zephyr.md',
      isFile: true,
    });
    expect(decision.kind).toBe('refile');
    if (decision.kind === 'refile') expect(decision.target).toBeUndefined();
  });
});

describe('moveEntry on a concept leaf', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'concept-move-'));
    await mkdir(path.join(root, 'wiki/concepts/unclassified'), { recursive: true });
    await mkdir(path.join(root, 'wiki/concepts/market-offering'), { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/unclassified/zephyr.md'),
      '---\nsubject: zephyr\n---\n\n# Zephyr\n');
    await writeFile(path.join(root, 'wiki/sources/note.md'),
      '---\n---\n\nSee [src: wiki/concepts/unclassified/zephyr.md] for details.\n');
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('moves the file and repoints the inbound links', async () => {
    const seen: Array<{ source: string; target: string }> = [];
    const result = await moveEntry(root, 'wiki/concepts/unclassified/zephyr.md', 'wiki/concepts/market-offering', {
      rewriteLinks: async (moves) => {
        seen.push(...moves);
        const notePath = path.join(root, 'wiki/sources/note.md');
        let note = await readFile(notePath, 'utf8');
        for (const move of moves) note = note.replaceAll(move.source, move.target);
        await writeFile(notePath, note);
      },
    });

    expect(result.ok).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/market-offering/zephyr.md'), 'utf8');
    expect(moved).toContain('subject: zephyr');
    expect(seen).toEqual([{
      source: 'wiki/concepts/unclassified/zephyr.md',
      target: 'wiki/concepts/market-offering/zephyr.md',
    }]);
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('[src: wiki/concepts/market-offering/zephyr.md]');
  });

  it('fills a missing subject from the file name, and never overwrites one that exists', async () => {
    await writeFile(path.join(root, 'wiki/concepts/unclassified/zephyr.md'),
      '---\n---\n\n# Zephyr\n');
    await moveEntry(root, 'wiki/concepts/unclassified/zephyr.md', 'wiki/concepts/market-offering');
    expect(await readFile(path.join(root, 'wiki/concepts/market-offering/zephyr.md'), 'utf8'))
      .toContain('subject: zephyr');

    await writeFile(path.join(root, 'wiki/concepts/unclassified/other.md'),
      '---\nsubject: something-else\n---\n\n# Other\n');
    await moveEntry(root, 'wiki/concepts/unclassified/other.md', 'wiki/concepts/market-offering');
    expect(await readFile(path.join(root, 'wiki/concepts/market-offering/other.md'), 'utf8'))
      .toContain('subject: something-else');
  });

  it('renames a taxo leaf to the new concept and updates its concept metadata', async () => {
    await mkdir(path.join(root, 'wiki/concepts/jedox'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/jedox/jedox_tarifs.md'),
      '---\ntitle: Jedox — tarifs\ntype: product\nsubject: tarifs\nconcept: jedox\n---\n\n# Jedox — tarifs\n');
    const seen: Array<{ source: string; target: string }> = [];
    await moveEntry(root, 'wiki/concepts/jedox/jedox_tarifs.md', 'wiki/concepts/market-offering', {
      rewriteLinks: async (moves) => { seen.push(...moves); },
    });

    const moved = await readFile(path.join(root, 'wiki/concepts/market-offering/market-offering_tarifs.md'), 'utf8');
    expect(moved).toContain('concept: market-offering');
    expect(moved).toContain('subject: tarifs');
    expect(seen).toEqual([{
      source: 'wiki/concepts/jedox/jedox_tarifs.md',
      target: 'wiki/concepts/market-offering/market-offering_tarifs.md',
    }]);
  });
});
