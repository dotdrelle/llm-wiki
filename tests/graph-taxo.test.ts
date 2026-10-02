import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTaxoGraph } from '../src/graph/wiki/taxoGraph.ts';
import { handleGraphRoutes, type GraphRoutesDeps } from '../src/serve/routes/graphRoutes.ts';
import { taxoStateScript } from '../src/graph/wiki/ui/taxo/taxoStateScript.ts';

let root: string;

const fiche = (title: string, description: string) =>
  `---\ntype: source\ntitle: ${title}\ndescription: ${description}\ntags:\n  - x\n---\n# ${title}\n\nBody.\n`;
const pivot = (title: string, family: string, cites: string[]) =>
  `---\ntype: concept\ntitle: ${title}\nfamily: ${family}\n---\n# ${title}\n\n## Sources\n\n${cites.map((c) => `- **${c}** — x [src: ${c}]`).join('\n')}\n`;

const A = 'wiki/sources/doc-a/section-1.md';
const B = 'wiki/sources/doc-a/section-2.md';
const C = 'wiki/sources/9f3e1c2ab-doc-b/intro.md';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'graph-taxo-'));
  const files: Record<string, string> = {
    [A]: fiche('Section one', 'First section.'),
    [B]: fiche('Section two', 'Second section.'),
    [C]: fiche('Intro', 'Intro of B.'),
    'wiki/concepts/securite/chiffrement.md': pivot('Chiffrement', 'Sécurité', [A, B]),
    'wiki/concepts/securite/acces.md': pivot('Accès', 'Sécurité', [A]),
    'wiki/concepts/projet/planning.md': pivot('Planning', 'Projet', [B, C, 'wiki/sources/missing.md']),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), content, 'utf8');
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('TAXO graph extraction', () => {
  it('reads concepts with their family, fiches, and the citations between them', async () => {
    const graph = await loadTaxoGraph(root);

    expect(graph.families).toEqual(['Sécurité', 'Projet']);
    expect(graph.nodes.filter((n) => n.type === 'concept').map((n) => [n.title, n.family]).sort())
      .toEqual([['Accès', 'Sécurité'], ['Chiffrement', 'Sécurité'], ['Planning', 'Projet']]);
    const source = graph.nodes.find((n) => n.id === C)!;
    expect(source).toMatchObject({ type: 'source', title: 'Intro', desc: 'Intro of B.', folder: 'Doc b' });
    // A citation to a page that does not exist draws no link.
    expect(graph.links).toHaveLength(5);
    expect(graph.links).not.toContainEqual(expect.objectContaining({ target: 'wiki/sources/missing.md' }));
  });

  it('settles the three force views server-side, for every node they draw', async () => {
    const graph = await loadTaxoGraph(root);

    expect(Object.keys(graph.layout.family).sort()).toEqual(
      ['f:Projet', 'f:Sécurité', ...graph.nodes.filter((n) => n.type === 'concept').map((n) => n.id)].sort());
    expect(Object.keys(graph.layout.full)).toHaveLength(graph.nodes.length);
    for (const [x, y] of Object.values(graph.layout.concepts)) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it('reuses the cached graph while nothing changed', async () => {
    expect(await loadTaxoGraph(root)).toBe(await loadTaxoGraph(root));
  });
});

function call(url: string, deps: Partial<GraphRoutesDeps> = {}) {
  const sent: { status?: number; body?: unknown } = {};
  const req = { method: 'GET', url, headers: {} } as unknown as IncomingMessage;
  const res = {} as ServerResponse;
  const full: GraphRoutesDeps = {
    rootDir: root,
    language: () => 'en',
    workspaceNameFromEnv: () => 'test',
    sendJson: (_res, status, body) => { sent.status = status; sent.body = body; },
    sendGzippedHtml: async () => {},
    ...deps,
  };
  return handleGraphRoutes(req, res, new URL(url, 'http://x').pathname, full).then(() => sent);
}

describe('graph search route', () => {
  it('answers through the injected engine search, mode included', async () => {
    const sent = await call('/api/graph/search?q=chiffrement', {
      searchWiki: async (q) => ({ mode: 'hybrid', reason: null, results: [{ path: A, score: q.length }] }),
    });
    expect(sent).toEqual({ status: 200, body: { mode: 'hybrid', reason: null, results: [{ path: A, score: 11 }] } });
  });

  it('says the search is unavailable instead of matching nothing', async () => {
    expect((await call('/api/graph/search?q=x')).status).toBe(503);
  });

  it('answers an empty query without searching', async () => {
    const sent = await call('/api/graph/search?q=%20', { searchWiki: async () => { throw new Error('called'); } });
    expect(sent.body).toEqual({ mode: 'lexical', reason: null, results: [] });
  });
});

describe('TAXO graph in the browser', () => {
  it('derives co-citation, cross-family links and membership from one payload', async () => {
    const graph = await loadTaxoGraph(root);
    const run = new Function('payload', `${taxoStateScript()}
      ingestTaxo(payload);
      return {cross:crossLinks.map(l=>[l.source,l.target,l.w]),co:coLinks.map(l=>[l.source,l.target,l.w]).sort(),families:famNodes.map(f=>[f.id,f.count,f.nsrc])};`);
    const out = run(graph) as { cross: unknown[]; co: unknown[]; families: unknown[] };

    // Sécurité cites A and B, Projet cites B and C: they share B.
    expect(out.cross).toEqual([['f:Sécurité', 'f:Projet', 1]]);
    expect(out.families).toEqual([['f:Sécurité', 2, 2], ['f:Projet', 1, 2]]);
    // A is cited by Accès and Chiffrement; B by Chiffrement and Planning.
    expect(out.co).toEqual([
      ['wiki/concepts/projet/planning.md', 'wiki/concepts/securite/chiffrement.md', 1],
      ['wiki/concepts/securite/acces.md', 'wiki/concepts/securite/chiffrement.md', 1],
    ]);
  });
});

describe('search state in the page', () => {
  it('spins while the engine answers, then names the mode, weak matches in amber', async () => {
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();

    expect(html).toContain('<span class="search-spinner" aria-hidden="true"></span>');
    expect(html).toContain("wrap.classList.toggle('is-searching',Boolean(query)&&!searchHits&&!searchError)");
    expect(html).toContain("mode==='hybrid'?'semantic + lexical'");
    expect(html).toContain("' · weak matches'");
    expect(html).toContain('.search-mode.degraded');
  });
});

describe('family layout and dragging', () => {
  it('keeps every pair of family halos apart', async () => {
    const graph = await loadTaxoGraph(root);
    const L = graph.layout.family;
    const reach = (f: string) => Math.max(30, ...graph.nodes.filter((n) => n.type === 'concept' && n.family === f)
      .map((n) => Math.hypot(L[n.id]![0] - L[`f:${f}`]![0], L[n.id]![1] - L[`f:${f}`]![1]) + 18));
    const [a, b] = graph.families as [string, string];
    const distance = Math.hypot(L[`f:${a}`]![0] - L[`f:${b}`]![0], L[`f:${a}`]![1] - L[`f:${b}`]![1]);
    expect(distance - reach(a) - reach(b)).toBeGreaterThanOrEqual(38);
  });

  it('moves a dragged family together with its concepts, and offers zoom buttons', async () => {
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();
    expect(html).toContain("if(n.type==='family')nodes.forEach(m=>{if(m.type==='concept'&&m.family===n.family){m.x+=dx;m.y+=dy;");
    expect(html).toContain('id="zoom-in" title="Zoom in"');
    expect(html).toContain('id="zoom-out" title="Zoom out"');
  });
});
