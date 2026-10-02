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
    })).toEqual({
      kind: 'refile',
      className: 'market-offering',
      subject: 'zephyr',
      target: 'wiki/concepts/market-offering/zephyr.md',
      isTagPage: false,
    });
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

  it('rejects the retired <concept>_<resume>.md concept-leaf format', () => {
    expect(decideConceptMove({
      from: 'wiki/concepts/jedox/jedox_tarifs.md',
      to: 'wiki/concepts/produit/jedox_tarifs.md',
      isFile: true,
    }).kind).toBe('reject');
  });

  it('keeps the plain name for a leaf that does not carry its concept in the file name', () => {
    const decision = decideConceptMove({
      from: 'wiki/concepts/unclassified/zephyr.md',
      to: 'wiki/concepts/market-offering/zephyr.md',
      isFile: true,
    });
    expect(decision.kind).toBe('refile');
    if (decision.kind === 'refile') {
      expect(decision.target).toBe('wiki/concepts/market-offering/zephyr.md');
      expect(decision.isTagPage).toBe(false);
    }
  });
});

describe('moveEntry on a concept leaf', () => {
  const destinationConceptId = '123e4567-e89b-42d3-a456-426614174000';
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

    expect(result.ok, JSON.stringify(result)).toBe(true);
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

  it('refuses to refile a retired concept-prefixed leaf', async () => {
    await mkdir(path.join(root, 'wiki/concepts/jedox'), { recursive: true });
    // A real taxo leaf's on-disk subject is concept-prefixed
    // (validateConsolidation derives it from the full basename) — a clean
    // unprefixed fixture here would not exercise the bug this test guards.
    await writeFile(path.join(root, 'wiki/concepts/jedox/jedox_tarifs.md'),
      '---\ntitle: Jedox — tarifs\ntype: product\nsubject: jedox-tarifs\nconcept: jedox\n---\n\n# Jedox — tarifs\n\nSee also concept: pricing in the body — must not be touched.\n');
    const result = await moveEntry(root, 'wiki/concepts/jedox/jedox_tarifs.md', 'wiki/concepts/market-offering');
    expect(result).toMatchObject({ ok: false, status: 400 });
    await expect(readFile(path.join(root, 'wiki/concepts/jedox/jedox_tarifs.md'), 'utf8'))
      .resolves.toContain('subject: jedox-tarifs');
  });

  it('moves a TAXO tag page between family folders without changing its tag identity or filename', async () => {
    await mkdir(path.join(root, 'wiki/concepts/unfiled'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/unfiled/network.md'), [
      '---', 'type: concept', 'subject: network', 'family: Unfiled',
      'concept_id: 123e4567-e89b-42d3-a456-426614174010',
      'subject_id: 123e4567-e89b-42d3-a456-426614174011',
      'tags: [network, infrastructure]', 'generated:', '  by: llm-wiki-tags',
      '---', '', '# Network', '',
    ].join('\n'));
    await writeFile(path.join(root, 'wiki/concepts/market-offering/saas.md'), [
      '---', 'family: Market Offering', 'concept_id: 123e4567-e89b-42d3-a456-426614174012', '---', '', '# SaaS', '',
    ].join('\n'));

    const result = await moveEntry(root, 'wiki/concepts/unfiled/network.md', 'wiki/concepts/market-offering');

    expect(result.ok).toBe(true);
    const moved = await readFile(path.join(root, 'wiki/concepts/market-offering/network.md'), 'utf8');
    expect(moved).toContain('subject: network');
    expect(moved).toContain('family: Market Offering');
    expect(moved).toContain('concept_id: 123e4567-e89b-42d3-a456-426614174010');
    expect(moved).toContain('subject_id: 123e4567-e89b-42d3-a456-426614174011');
    expect(moved).toContain('  - network');
    expect(moved).toContain('  - infrastructure');
  });

  it('refiles a leaf onto a taken physical name under its own subject', async () => {
    // Two folders may legitimately hold a same-named file: the subject is the
    // identity, the file name only its label. The move must land as <subject>.md
    // instead of being refused.
    await writeFile(path.join(root, 'wiki/concepts/unclassified/note.md'),
      '---\nsubject: zephyr\n---\n\n# Note\n');
    await writeFile(path.join(root, 'wiki/concepts/market-offering/note.md'),
      `---\nconcept_id: ${destinationConceptId}\nsubject: anaplan\nsubject_id: 223e4567-e89b-42d3-a456-426614174000\n---\n\n# Note\n`);
    const seen: Array<{ source: string; target: string }> = [];

    const result = await moveEntry(root, 'wiki/concepts/unclassified/note.md', 'wiki/concepts/market-offering', {
      rewriteLinks: async (moves) => { seen.push(...moves); },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.to).toBe('wiki/concepts/market-offering/zephyr.md');
    expect(await readFile(path.join(root, 'wiki/concepts/market-offering/zephyr.md'), 'utf8'))
      .toContain('subject: zephyr');
    // The leaf that already owned the name is untouched.
    expect(await readFile(path.join(root, 'wiki/concepts/market-offering/note.md'), 'utf8'))
      .toContain('subject: anaplan');
    expect(seen).toEqual([{
      source: 'wiki/concepts/unclassified/note.md',
      target: 'wiki/concepts/market-offering/zephyr.md',
    }]);
  });

  it('still refuses when the subject identity is already filed in the destination', async () => {
    await writeFile(path.join(root, 'wiki/concepts/unclassified/note.md'),
      '---\nsubject: zephyr\n---\n\n# Note\n');
    await writeFile(path.join(root, 'wiki/concepts/market-offering/note.md'),
      '---\nsubject: anaplan\n---\n\n# Note\n');
    await writeFile(path.join(root, 'wiki/concepts/market-offering/zephyr.md'),
      '---\nsubject: zephyr\n---\n\n# Zephyr\n');

    const result = await moveEntry(root, 'wiki/concepts/unclassified/note.md', 'wiki/concepts/market-offering');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    // Nothing moved: the collision belongs to whoever moves.
    expect(await readFile(path.join(root, 'wiki/concepts/unclassified/note.md'), 'utf8'))
      .toContain('subject: zephyr');
  });

  it('keeps the 409 when the leaf name already is its subject', async () => {
    await writeFile(path.join(root, 'wiki/concepts/market-offering/zephyr.md'),
      '---\nsubject: zephyr\n---\n\n# Zephyr\n');
    const result = await moveEntry(root, 'wiki/concepts/unclassified/zephyr.md', 'wiki/concepts/market-offering');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});
