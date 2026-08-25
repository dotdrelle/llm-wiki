import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import {
  buildReclassifyUserPrompt,
  listUnclassifiedPages,
  reclassifyConcepts,
  validateReclassifyProposal,
  type ReclassifyProposal,
  type UnclassifiedPage,
} from '../src/services/conceptReclassifyService.ts';
import { readConceptGrid } from '../src/ingest/conceptGrid.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
    llm: {
      provider: 'openai-compatible',
      engine: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      buildStrategy: 'bm25',
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: false,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

const GRID_MD = [
  '# Concepts grid',
  '',
  '```yaml',
  'class:',
  '  - offre-marche',
  '  - economie-projet',
  '```',
  '',
].join('\n');

async function makeWorkspace(): Promise<{ root: string; workspace: WorkspaceService }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-reclassify-'));
  await mkdir(path.join(root, 'wiki', 'concepts', 'unclassified'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
  return { root, workspace: new WorkspaceService(createConfig(root)) };
}

async function writeUnclassifiedPage(root: string, subject: string, body = '# Page\n'): Promise<void> {
  await writeFile(
    path.join(root, 'wiki', 'concepts', 'unclassified', `${subject}.md`),
    `---\nclass: unclassified\nsubject: ${subject}\n---\n${body}`,
    'utf8',
  );
}

describe('reclassifyConcepts', () => {
  it('skips with no_grid when the workspace has no concept grid yet', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeUnclassifiedPage(root, 'jedox');
    const outcome = await reclassifyConcepts(workspace, { language: 'fr' }, { propose: async () => ({ assignments: {} }) });
    expect(outcome).toEqual({ status: 'skipped', reason: 'no_grid' });
  });

  it('skips with nothing_to_reclassify when no page sits under unclassified/', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    const outcome = await reclassifyConcepts(workspace, { language: 'fr' }, { propose: async () => ({ assignments: {} }) });
    expect(outcome).toEqual({ status: 'skipped', reason: 'nothing_to_reclassify' });
  });

  it('skips with no_llm when no propose function is wired, even with pending pages', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'jedox');
    const outcome = await reclassifyConcepts(workspace, { language: 'fr' }, {});
    expect(outcome).toEqual({ status: 'skipped', reason: 'no_llm' });
  });

  it('moves a page into its assigned class, rewrites its provenance and every wiki link to it', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'jedox', '# Jedox\n\nUn éditeur EPM.\n');
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'sources', 'note.md'),
      '# Note\n\nVoir [wiki/concepts/unclassified/jedox.md](wiki/concepts/unclassified/jedox.md).\n',
      'utf8',
    );

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => ({ assignments: { 'wiki/concepts/unclassified/jedox.md': 'offre-marche' } }) },
    );

    expect(outcome.status).toBe('reclassified');
    if (outcome.status !== 'reclassified') throw new Error('unreachable');
    expect(outcome.plan.moves).toEqual([
      { path: 'wiki/concepts/unclassified/jedox.md', subject: 'jedox', to: 'wiki/concepts/offre-marche/jedox.md', class: 'offre-marche' },
    ]);
    expect(outcome.plan.skipped).toEqual([]);

    const moved = await readFile(path.join(root, 'wiki', 'concepts', 'offre-marche', 'jedox.md'), 'utf8');
    expect(moved).toContain('class: offre-marche');
    expect(moved).toContain('Un éditeur EPM.');
    await expect(
      readFile(path.join(root, 'wiki', 'concepts', 'unclassified', 'jedox.md'), 'utf8'),
    ).rejects.toThrow();

    const note = await readFile(path.join(root, 'wiki', 'sources', 'note.md'), 'utf8');
    expect(note).toContain('wiki/concepts/offre-marche/jedox.md');
    expect(note).not.toContain('unclassified/jedox.md');
  });

  it('reclassifies a page orphaned by a grid rebuild, even though it never sat under unclassified/', async () => {
    // Regression, confirmed on a live workspace: `wiki concepts --apply`
    // synthesizes a fresh grid from raw/ingested/** on every run, with no
    // guaranteed continuity of class names. A page filed under a class that
    // existed in an EARLIER grid but was dropped/renamed by a LATER rebuild
    // sits at wiki/concepts/<old-class>/<subject>.md with a class: value the
    // current grid no longer declares — not under unclassified/, so the old
    // path-only scan never saw it, and it silently fell out of the taxonomy
    // entirely (most of a real 24-page corpus ended up this way, producing a
    // near-empty, unusable taxonomy: two tiny real domains plus a huge
    // catch-all bucket).
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await mkdir(path.join(root, 'wiki', 'concepts', 'tool-catalogue'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'tool-catalogue', 'orea.md'),
      '---\nclass: tool-catalogue\nsubject: orea\n---\n# OREA\n\nOutil de prévision.\n',
      'utf8',
    );

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => ({ assignments: { 'wiki/concepts/tool-catalogue/orea.md': 'offre-marche' } }) },
    );

    expect(outcome.status).toBe('reclassified');
    if (outcome.status !== 'reclassified') throw new Error('unreachable');
    expect(outcome.plan.moves).toEqual([
      { path: 'wiki/concepts/tool-catalogue/orea.md', subject: 'orea', to: 'wiki/concepts/offre-marche/orea.md', class: 'offre-marche' },
    ]);
    const moved = await readFile(path.join(root, 'wiki', 'concepts', 'offre-marche', 'orea.md'), 'utf8');
    expect(moved).toContain('class: offre-marche');
  });

  it('leaves an already-valid page alone: its class is in the current grid', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await mkdir(path.join(root, 'wiki', 'concepts', 'offre-marche'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'offre-marche', 'existing.md'),
      '---\nclass: offre-marche\nsubject: existing\n---\n# Existing\n',
      'utf8',
    );
    const outcome = await reclassifyConcepts(workspace, { language: 'fr' }, { propose: async () => ({ assignments: {} }) });
    expect(outcome).toEqual({ status: 'skipped', reason: 'nothing_to_reclassify' });
  });

  it('strips citations before truncating, so a marker past the citation-bloated prefix still reaches the excerpt', async () => {
    // Regression: a real leaf repeats its long [src: raw/ingested/…] citation
    // on nearly every bullet. A plain character-count slice of EXCERPT_CHARS
    // spent most of the budget on repeated citation paths and never reached
    // content further down the page — which is exactly what happened to a
    // real "dirnc" page (ESX/hyperviseur evidence past the cut, "unclassified"
    // answered instead of the obviously matching class).
    const { root, workspace } = await makeWorkspace();
    const longCitation = '[src: raw/ingested/dirnctti/accueil-du-service-informatique-de-la-dirnc-tti/partage-documentaire-avec-les-autres-services/juno-inventaire-materiellogicielreseau-des-dirom.md]';
    const paddingBullets = Array.from({ length: 8 }, (_, i) => `- Padding bullet number ${i}. ${longCitation}`).join('\n');
    await writeUnclassifiedPage(root, 'jedox', `# Jedox\n\n${paddingBullets}\n\n## Serveurs ESX\n\nMARKER_INFRA_SIGNAL exécutant ESXi et vCenter.\n`);

    const pages = await listUnclassifiedPages(workspace, { classes: ['offre-marche'], set: new Set(['offre-marche']) });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.excerpt).not.toContain('[src:');
    expect(pages[0]!.excerpt).toContain('MARKER_INFRA_SIGNAL');

    const prompt = buildReclassifyUserPrompt(pages, {
      classes: ['offre-marche'],
      set: new Set(['offre-marche']),
    });
    expect(prompt).toContain('MARKER_INFRA_SIGNAL');
  });

  it('leaves a page unclassified, without moving it, when the model answers the reserved class', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'orphan');

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => ({ assignments: { 'wiki/concepts/unclassified/orphan.md': 'unclassified' } }) },
    );

    expect(outcome.status).toBe('reclassified');
    if (outcome.status !== 'reclassified') throw new Error('unreachable');
    expect(outcome.plan.moves).toEqual([]);
    expect(outcome.plan.skipped).toEqual([{ path: 'wiki/concepts/unclassified/orphan.md', subject: 'orphan', reason: 'no class fits' }]);
    await expect(
      readFile(path.join(root, 'wiki', 'concepts', 'unclassified', 'orphan.md'), 'utf8'),
    ).resolves.toContain('class: unclassified');
  });

  it('skips a move whose target path is already taken by another leaf', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'jedox');
    await mkdir(path.join(root, 'wiki', 'concepts', 'offre-marche'), { recursive: true });
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'offre-marche', 'jedox.md'),
      '---\nclass: offre-marche\nsubject: jedox\n---\n# Jedox (existing)\n',
      'utf8',
    );

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => ({ assignments: { 'wiki/concepts/unclassified/jedox.md': 'offre-marche' } }) },
    );

    expect(outcome.status).toBe('reclassified');
    if (outcome.status !== 'reclassified') throw new Error('unreachable');
    expect(outcome.plan.moves).toEqual([]);
    expect(outcome.plan.skipped).toEqual([
      { path: 'wiki/concepts/unclassified/jedox.md', subject: 'jedox', reason: 'target exists: wiki/concepts/offre-marche/jedox.md' },
    ]);
    // The pre-existing target page is untouched, not overwritten.
    await expect(
      readFile(path.join(root, 'wiki', 'concepts', 'offre-marche', 'jedox.md'), 'utf8'),
    ).resolves.toContain('Jedox (existing)');
  });

  it('skips the second of two pages in the same batch assigned the same target, instead of silently overwriting the first', async () => {
    // Regression: two distinct unclassified pages sharing a subject (the
    // still-open concept-homonym case) assigned to the same class compute the
    // identical target path. Neither exists on disk when checked, so without
    // a claimed-targets guard both would be queued; applying them in order
    // would overwrite the first page's freshly-written content with the
    // second's, right after deleting the first page's own source — permanent,
    // silent loss reported as two successful moves.
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'unclassified', 'jedox-a.md'),
      '---\nclass: unclassified\nsubject: jedox\n---\n# Jedox A\n\nFirst page, must survive.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'unclassified', 'jedox-b.md'),
      '---\nclass: unclassified\nsubject: jedox\n---\n# Jedox B\n\nSecond page, same subject.\n',
      'utf8',
    );

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      {
        propose: async () => ({
          assignments: {
            'wiki/concepts/unclassified/jedox-a.md': 'offre-marche',
            'wiki/concepts/unclassified/jedox-b.md': 'offre-marche',
          },
        }),
      },
    );

    expect(outcome.status).toBe('reclassified');
    if (outcome.status !== 'reclassified') throw new Error('unreachable');
    expect(outcome.plan.moves).toEqual([
      { path: 'wiki/concepts/unclassified/jedox-a.md', subject: 'jedox', to: 'wiki/concepts/offre-marche/jedox.md', class: 'offre-marche' },
    ]);
    expect(outcome.plan.skipped).toEqual([
      { path: 'wiki/concepts/unclassified/jedox-b.md', subject: 'jedox', reason: 'target already claimed by another page in this batch: wiki/concepts/offre-marche/jedox.md' },
    ]);
    // The first page's content actually landed, and the second page was left
    // in place rather than being applied and silently lost.
    const moved = await readFile(path.join(root, 'wiki', 'concepts', 'offre-marche', 'jedox.md'), 'utf8');
    expect(moved).toContain('First page, must survive.');
    const stillThere = await readFile(path.join(root, 'wiki', 'concepts', 'unclassified', 'jedox-b.md'), 'utf8');
    expect(stillThere).toContain('Second page, same subject.');
  });

  it('rejects after exhausting retries on a proposal that never validates', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'jedox');

    let calls = 0;
    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => { calls += 1; return { assignments: { 'wiki/concepts/unclassified/jedox.md': 'not-a-real-class' } }; } },
    );

    expect(outcome.status).toBe('rejected');
    expect(calls).toBe(3);
    if (outcome.status !== 'rejected') throw new Error('unreachable');
    expect(outcome.issues.join(' ')).toContain('unknown class');
  });

  it('degrades to a validation issue instead of throwing when the LLM call itself fails', async () => {
    const { root, workspace } = await makeWorkspace();
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    await writeUnclassifiedPage(root, 'jedox');

    const outcome = await reclassifyConcepts(
      workspace,
      { language: 'fr' },
      { propose: async () => { throw new Error('provider down'); } },
    );

    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('unreachable');
    expect(outcome.issues[0]).toContain('provider down');
  });
});

describe('validateReclassifyProposal', () => {
  const grid = (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-reclassify-grid-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID_MD, 'utf8');
    const read = await readConceptGrid(root);
    if (read.status !== 'ok') throw new Error('fixture grid must parse');
    return read.grid;
  })();

  const pages: UnclassifiedPage[] = [{ path: 'wiki/concepts/unclassified/jedox.md', subject: 'jedox', excerpt: '' }];

  it('flags an assignment for a page outside the plan', async () => {
    const proposal: ReclassifyProposal = { assignments: { 'wiki/concepts/unclassified/jedox.md': 'offre-marche', 'wiki/concepts/unclassified/ghost.md': 'offre-marche' } };
    const issues = validateReclassifyProposal(proposal, pages, await grid);
    expect(issues).toContain('unknown page: wiki/concepts/unclassified/ghost.md');
  });

  it('flags a page missing from the assignments', async () => {
    const proposal: ReclassifyProposal = { assignments: {} };
    const issues = validateReclassifyProposal(proposal, pages, await grid);
    expect(issues).toContain('page not assigned: wiki/concepts/unclassified/jedox.md');
  });

  it('accepts the reserved unclassified id as a valid answer', async () => {
    const proposal: ReclassifyProposal = { assignments: { 'wiki/concepts/unclassified/jedox.md': 'unclassified' } };
    expect(validateReclassifyProposal(proposal, pages, await grid)).toEqual([]);
  });
});
