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
      from: 'wiki/concepts/unclassified/anaplan.md',
      to: 'wiki/concepts/offre-marche/anaplan.md',
      isFile: true,
    })).toEqual({ kind: 'refile', className: 'offre-marche', subject: 'anaplan' });
  });

  it('refuses a leaf dropped straight under wiki/concepts, with no concept folder', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/anaplan.md',
      to: 'wiki/concepts/anaplan.md',
      isFile: true,
    });
    expect(decision.kind).toBe('reject');
  });

  it('refuses to move a whole concept folder', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/offre-marche',
      to: 'wiki/concepts/securite-souverainete/offre-marche',
      isFile: false,
    });
    expect(decision.kind).toBe('reject');
  });
});

describe('moveEntry on a concept leaf', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'concept-move-'));
    await mkdir(path.join(root, 'wiki/concepts/unclassified'), { recursive: true });
    await mkdir(path.join(root, 'wiki/concepts/offre-marche'), { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/unclassified/anaplan.md'),
      '---\nsubject: anaplan\n---\n\n# Anaplan\n');
    await writeFile(path.join(root, 'wiki/sources/note.md'),
      '---\n---\n\nSee [src: wiki/concepts/unclassified/anaplan.md] for details.\n');
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('moves the file and repoints the inbound links', async () => {
    const seen: Array<{ source: string; target: string }> = [];
    const result = await moveEntry(root, 'wiki/concepts/unclassified/anaplan.md', 'wiki/concepts/offre-marche', {
      rewriteLinks: async (moves) => {
        seen.push(...moves);
        const notePath = path.join(root, 'wiki/sources/note.md');
        let note = await readFile(notePath, 'utf8');
        for (const move of moves) note = note.replaceAll(move.source, move.target);
        await writeFile(notePath, note);
      },
    });

    expect(result.ok).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/offre-marche/anaplan.md'), 'utf8');
    expect(moved).toContain('subject: anaplan');
    expect(seen).toEqual([{
      source: 'wiki/concepts/unclassified/anaplan.md',
      target: 'wiki/concepts/offre-marche/anaplan.md',
    }]);
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('[src: wiki/concepts/offre-marche/anaplan.md]');
  });

  it('fills a missing subject from the file name, and never overwrites one that exists', async () => {
    await writeFile(path.join(root, 'wiki/concepts/unclassified/anaplan.md'),
      '---\n---\n\n# Anaplan\n');
    await moveEntry(root, 'wiki/concepts/unclassified/anaplan.md', 'wiki/concepts/offre-marche');
    expect(await readFile(path.join(root, 'wiki/concepts/offre-marche/anaplan.md'), 'utf8'))
      .toContain('subject: anaplan');

    await writeFile(path.join(root, 'wiki/concepts/unclassified/other.md'),
      '---\nsubject: something-else\n---\n\n# Other\n');
    await moveEntry(root, 'wiki/concepts/unclassified/other.md', 'wiki/concepts/offre-marche');
    expect(await readFile(path.join(root, 'wiki/concepts/offre-marche/other.md'), 'utf8'))
      .toContain('subject: something-else');
  });
});
