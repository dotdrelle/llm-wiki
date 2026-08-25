import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeSimpleTaxonomy } from '../src/graph/wiki/taxonomy/simple.ts';

/*
 The legacy clustering path runs whenever no concept grid exists yet — which
 is exactly the state of every workspace right after `wiki ingest` and before
 anyone has run `wiki concepts --apply`. Nothing forced that order: `ingest`'s
 auto-chained taxonomy task runs this same path silently. A taxonomy published
 this way must say so, or an operator has no way to know a grid would produce
 a materially better, stable tree.
*/

const page = (subject: string, body: string) => `# ${subject}\n\n${body}\n`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'taxonomy-legacy-'));
  await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
  // No wiki/concepts-grid.md: this is exactly the "no grid yet" state.
  for (const subject of ['alpha', 'beta', 'gamma', 'delta']) {
    await writeFile(path.join(root, 'wiki', 'concepts', `${subject}.md`), page(subject, `About ${subject}.`), 'utf8');
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('synthesizeSimpleTaxonomy — legacy path (no grid)', () => {
  it('warns that it used legacy clustering, not the grid-based join', async () => {
    const propose = async () => ({
      domains: [
        { id: 'd1', label: 'Pilotage projet' },
        { id: 'd2', label: 'Sécurité conformité' },
      ],
      communities: [
        { id: 'c1', label: 'Éditeurs marché', domain: 'd1' },
        { id: 'c2', label: 'Chiffrage budget', domain: 'd1' },
        { id: 'c3', label: 'Contrôles internes', domain: 'd2' },
        { id: 'c4', label: 'Certifications cloud', domain: 'd2' },
      ],
      assignments: {
        'wiki/concepts/alpha.md': 'c1',
        'wiki/concepts/beta.md': 'c2',
        'wiki/concepts/gamma.md': 'c3',
        'wiki/concepts/delta.md': 'c4',
      },
    });

    const outcome = await synthesizeSimpleTaxonomy(root, { language: 'fr' }, { propose });

    expect(outcome.status).toBe('published');
    if (outcome.status !== 'published') throw new Error('unreachable');
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('No concept grid exists yet');
    expect(outcome.warnings[0]).toContain('wiki concepts --apply');
  });
});
