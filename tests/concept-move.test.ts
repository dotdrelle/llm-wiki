import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decideConceptMove } from '../src/serve/tree/conceptMove.ts';
import { moveEntry } from '../src/serve/tree/treeMutations.ts';

/*
 Re-filing a concept leaf by hand.

 A leaf carries its axes twice — frontmatter and path — and the two readers
 disagree: ingestion makes the path authoritative, the taxonomy reads the
 frontmatter and never looks at the path. A bare rename therefore moved the
 file and changed nothing the taxonomy could see: the page stayed filed under
 `unclassified`, silently, and every inbound [src: …] pointed at a path that no
 longer existed.
*/

const GRID = { status: 'ok', set: new Set(['offre-marche', 'securite-souverainete']) } as const;

describe('decideConceptMove', () => {
  it('ignores a move that touches nothing under wiki/concepts', () => {
    expect(decideConceptMove({ from: 'wiki/sources/a.md', to: 'wiki/sources/b/a.md', isFile: true, grid: GRID }))
      .toEqual({ kind: 'ignore' });
  });

  it('re-files a leaf dragged out of unclassified into a class of the grid', () => {
    expect(decideConceptMove({
      from: 'wiki/concepts/unclassified/anaplan.md',
      to: 'wiki/concepts/offre-marche/anaplan.md',
      isFile: true,
      grid: GRID,
    })).toEqual({ kind: 'refile', className: 'offre-marche', subject: 'anaplan' });
  });

  it('refuses a class the grid does not declare', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/anaplan.md',
      to: 'wiki/concepts/inventee/anaplan.md',
      isFile: true,
      grid: GRID,
    });
    expect(decision.kind).toBe('reject');
    expect(decision.kind === 'reject' && decision.reason).toContain('inventee');
  });

  it('accepts the reserved unclassified class, which is never in the grid', () => {
    expect(decideConceptMove({
      from: 'wiki/concepts/offre-marche/anaplan.md',
      to: 'wiki/concepts/unclassified/anaplan.md',
      isFile: true,
      grid: GRID,
    })).toEqual({ kind: 'refile', className: 'unclassified', subject: 'anaplan' });
  });

  it('refuses a leaf dropped straight under wiki/concepts, with no class', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/anaplan.md',
      to: 'wiki/concepts/anaplan.md',
      isFile: true,
      grid: GRID,
    });
    expect(decision.kind).toBe('reject');
    expect(decision.kind === 'reject' && decision.reason).toContain('<class>');
  });

  it('refuses to move a whole class folder, which is a grid operation', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/offre-marche',
      to: 'wiki/concepts/securite-souverainete/offre-marche',
      isFile: false,
      grid: GRID,
    });
    expect(decision.kind).toBe('reject');
    expect(decision.kind === 'reject' && decision.reason).toContain('retire or empty the class');
  });

  it('lets a workspace with no grid yet file by hand, but stops on a broken one', () => {
    const target = { from: 'wiki/concepts/unclassified/a.md', to: 'wiki/concepts/x/a.md', isFile: true };
    expect(decideConceptMove({ ...target, grid: { status: 'absent' } }).kind).toBe('refile');
    expect(decideConceptMove({ ...target, grid: { status: 'malformed', issues: ['no class block'] } }).kind).toBe('reject');
  });
});

describe('moveEntry on a concept leaf', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'concept-move-'));
    await mkdir(path.join(root, 'wiki/concepts/unclassified'), { recursive: true });
    await mkdir(path.join(root, 'wiki/concepts/offre-marche'), { recursive: true });
    await mkdir(path.join(root, 'wiki/sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts-grid.md'),
      ['# Conceptual grid', '', '## Controlled vocabulary', '', '```yaml', 'class:',
       '  - offre-marche', '  - securite-souverainete', '```', ''].join('\n'));
    await writeFile(path.join(root, 'wiki/concepts/unclassified/anaplan.md'),
      '---\nclass: unclassified\nsubject: anaplan\n---\n\n# Anaplan\n');
    await writeFile(path.join(root, 'wiki/sources/note.md'),
      '---\n---\n\nSee [src: wiki/concepts/unclassified/anaplan.md] for details.\n');
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('moves the file, rewrites its class, and repoints the inbound links', async () => {
    const seen: Array<{ source: string; target: string }> = [];
    const result = await moveEntry(root, 'wiki/concepts/unclassified/anaplan.md', 'wiki/concepts/offre-marche', {
      rewriteLinks: async (moves) => {
        seen.push(...moves);
        // Stand-in for rewriteWikiLinks, which needs a WorkspaceService.
        const notePath = path.join(root, 'wiki/sources/note.md');
        let note = await readFile(notePath, 'utf8');
        for (const move of moves) note = note.replaceAll(move.source, move.target);
        await writeFile(notePath, note);
      },
    });

    expect(result.ok).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/offre-marche/anaplan.md'), 'utf8');
    expect(moved).toContain('class: offre-marche');
    expect(moved).not.toContain('class: unclassified');
    expect(moved).toContain('subject: anaplan');
    expect(seen).toEqual([{
      source: 'wiki/concepts/unclassified/anaplan.md',
      target: 'wiki/concepts/offre-marche/anaplan.md',
    }]);
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('[src: wiki/concepts/offre-marche/anaplan.md]');
  });

  it('refuses a class outside the grid without touching the file', async () => {
    await mkdir(path.join(root, 'wiki/concepts/inventee'), { recursive: true });
    const result = await moveEntry(root, 'wiki/concepts/unclassified/anaplan.md', 'wiki/concepts/inventee');

    expect(result.ok).toBe(false);
    // Named, so this cannot pass on an unrelated refusal: an earlier version of
    // this fixture wrote a grid the parser read as malformed, and the test went
    // green on "the grid cannot be read" while asserting nothing about classes.
    expect(result.ok === false && result.error).toContain('inventee');
    // The refusal must leave the corpus exactly as it was: half a move is worse
    // than none, because nothing says which half happened.
    await expect(stat(path.join(root, 'wiki/concepts/unclassified/anaplan.md'))).resolves.toBeTruthy();
    await expect(stat(path.join(root, 'wiki/concepts/inventee/anaplan.md'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'wiki/sources/note.md'), 'utf8'))
      .toContain('wiki/concepts/unclassified/anaplan.md');
  });

  it('fills a missing subject from the file name, and never overwrites one that exists', async () => {
    await writeFile(path.join(root, 'wiki/concepts/unclassified/anaplan.md'),
      '---\nclass: unclassified\n---\n\n# Anaplan\n');
    await moveEntry(root, 'wiki/concepts/unclassified/anaplan.md', 'wiki/concepts/offre-marche');
    expect(await readFile(path.join(root, 'wiki/concepts/offre-marche/anaplan.md'), 'utf8'))
      .toContain('subject: anaplan');

    // A subject that disagrees with the file name is a pre-existing defect; a
    // move has no mandate to decide about it.
    await writeFile(path.join(root, 'wiki/concepts/unclassified/other.md'),
      '---\nclass: unclassified\nsubject: something-else\n---\n\n# Other\n');
    await moveEntry(root, 'wiki/concepts/unclassified/other.md', 'wiki/concepts/offre-marche');
    expect(await readFile(path.join(root, 'wiki/concepts/offre-marche/other.md'), 'utf8'))
      .toContain('subject: something-else');
  });
});
