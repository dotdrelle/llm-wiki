import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPageBrief } from '../src/graph/wiki/taxonomy/simple.ts';

/*
 `readPageBrief` feeds the derived taxonomy the class/subject it files by. It
 must read them through the validated provenance reader (`readProvenance`), not
 raw frontmatter: an invalid value must count as absent, otherwise a page would
 be filed under a class nobody validated.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'read-page-brief-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readPageBrief', () => {
  it('lit la provenance via le lecteur validé : un class/subject invalide est absent', async () => {
    await writeFile(
      path.join(root, 'leaf.md'),
      '---\nclass: Offre Marché\nsubject: ALPHA!\nkind: product\n---\n\n# Alpha\n\nContenu.\n',
      'utf8',
    );
    const brief = await readPageBrief(root, 'leaf.md');
    expect(brief.class).toBeNull();
    expect(brief.subject).toBeNull();
    expect(brief.kind).toBe('product');
  });

  it('conserve un class et un subject valides', async () => {
    await writeFile(
      path.join(root, 'leaf.md'),
      '---\nclass: offre-marche\nsubject: alpha\n---\n\n# Alpha\n\nContenu.\n',
      'utf8',
    );
    const brief = await readPageBrief(root, 'leaf.md');
    expect(brief.class).toBe('offre-marche');
    expect(brief.subject).toBe('alpha');
  });
});
