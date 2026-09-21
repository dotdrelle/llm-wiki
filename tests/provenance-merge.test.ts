import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeDuplicateLeaves, planMergeGroups } from '../src/provenance/merge.ts';

async function writePage(root: string, rel: string, content: string): Promise<void> {
  const absolute = path.join(root, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

describe('deterministic leaf merge (item 1)', () => {
  it('groups same-concept leaves whose subjects share an entity root', () => {
    const groups = planMergeGroups([
      { path: 'wiki/concepts/produit/prophix.md', concept: 'produit', subject: 'prophix' },
      { path: 'wiki/concepts/produit/prophix-one.md', concept: 'produit', subject: 'prophix-one' },
      { path: 'wiki/concepts/produit/board.md', concept: 'produit', subject: 'board' },
      { path: 'wiki/concepts/cout/prophix.md', concept: 'cout', subject: 'prophix' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical).toBe('wiki/concepts/produit/prophix.md');
    expect(groups[0].merged).toEqual(['wiki/concepts/produit/prophix-one.md']);
  });

  it('merges bodies and sources, then removes the duplicate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-merge-'));
    await writePage(root, 'raw/ingested/a.md', '# A\n\n## Coûts\n\nA.\n');
    await writePage(root, 'raw/ingested/b.md', '# B\n\n## Sécurité\n\nB.\n');
    await writePage(root, 'wiki/concepts/produit/prophix.md', '---\nsubject: prophix\ntype: product\nsources:\n  - path: raw/ingested/a.md\n---\n\n## Coûts\n\nA. [src: raw/ingested/a.md#A > Coûts]\n');
    await writePage(root, 'wiki/concepts/produit/prophix-one.md', '---\nsubject: prophix-one\ntype: product\nsources:\n  - path: raw/ingested/b.md\n---\n\n## Sécurité\n\nB. [src: raw/ingested/b.md#B > Sécurité]\n');

    const report = await mergeDuplicateLeaves({ rootDir: root, apply: true });
    expect(report.groupsMerged).toBe(1);
    expect(report.leavesRemoved).toBe(1);

    const canonical = await readFile(path.join(root, 'wiki/concepts/produit/prophix.md'), 'utf8');
    expect(canonical).toContain('Coûts');
    expect(canonical).toContain('Sécurité');
    expect(canonical).toContain('raw/ingested/a.md');
    expect(canonical).toContain('raw/ingested/b.md');
    expect(existsSync(path.join(root, 'wiki/concepts/produit/prophix-one.md'))).toBe(false);
  });
});
