import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProvenanceGraph, type ProvenanceGraph } from '../src/graph/wiki/provenanceGraph.ts';
import { createEvidenceManifest, resolveEvidence, writeEvidenceManifest } from '../src/provenance/resolver.ts';
import { handleGraphRoutes, type GraphRoutesDeps } from '../src/serve/routes/graphRoutes.ts';
import { exportArtifactSourcePath } from '../src/utils/exportArtifact.ts';
import { PROVENANCE_SCRIPT } from '../src/graph/wiki/ui/provenance/provenanceScript.ts';

let root: string;

const DELIVERABLE = 'deliverables/notes/basic-note.md';
const OFFRE = 'raw/ingested/offre.md';
const AUDIT = 'raw/ingested/audit.md';
const TARIFS = 'wiki/sources/offre/tarifs.md';
const LOCALISATION = 'wiki/sources/offre/localisation.md';
const CONCLUSIONS = 'wiki/sources/audit/conclusions.md';
const COUT = 'wiki/concepts/hebergement/cout.md';

const files: Record<string, string> = {
  [OFFRE]: '# Offre cloud\n\n## Tarifs\n\nForfait annuel 18 400 EUR.\n\n## Localisation\n\nParis et Lille.\n',
  [AUDIT]: '# Audit SecNum\n\n## Conclusions\n\nPas de chiffrement au repos en recette.\n',
  [TARIFS]: `---\ntype: source\ntitle: Tarifs\n---\n# Tarifs\n\nForfait annuel. [src: ${OFFRE}#Tarifs]\n`,
  [LOCALISATION]: `---\ntype: source\ntitle: Localisation\n---\n# Localisation\n\nDeux centres. [src: ${OFFRE}#Localisation]\n`,
  [CONCLUSIONS]: `---\ntype: source\ntitle: Conclusions\n---\n# Conclusions\n\nChiffrement absent. [src: ${AUDIT}#Conclusions]\n`,
  [COUT]: `---\ntype: concept\ntitle: Coût d'hébergement\nfamily: Hébergement\n---\n# Coût d'hébergement\n\n## Coûts\n\n- Forfait [src: ${TARIFS}]\n`,
  'templates/notes/basic-note.md': '---\ntitle: Basic Note\nbuild_context:\n  - build-context/rules/citations.md\n---\n# Basic Note\n',
  'build-context/rules/citations.md': '# Citation rules\n',
  '.wiki/build-state.json': JSON.stringify({
    deliverables: {
      'templates/notes/basic-note.md': {
        templateHash: 'x', wikiHash: 'x', buildContextHash: '', outputHash: 'x', outputRelativePath: DELIVERABLE,
      },
    },
  }),
};

const body = [
  '# Basic Note',
  '',
  '## Summary',
  '',
  `Forfait [src: ${COUT}#Coûts]. Localisation [src: ${LOCALISATION}].`,
  '',
  '## Key Facts',
  '',
  `- Forfait [src: ${COUT}#Coûts]`,
  `- Audit [src: ${CONCLUSIONS}]`,
  '',
].join('\n');

async function put(file: string, content: string) {
  await mkdir(path.join(root, path.dirname(file)), { recursive: true });
  await writeFile(path.join(root, file), content, 'utf8');
}

/** What build does: resolve, freeze the manifest, stamp the deliverable. */
async function build(): Promise<string> {
  const loadDocument = (file: string) => {
    try { return readFileSync(path.join(root, file), 'utf8'); } catch { return null; }
  };
  const { fragments } = resolveEvidence({ content: body, loadDocument });
  const target = await writeEvidenceManifest(root, createEvidenceManifest('deliverables_notes_basic-note.md-abc123', fragments));
  const buildId = path.basename(path.dirname(target));
  await put(DELIVERABLE, matter.stringify(body, { title: 'Basic Note', evidence_build_id: buildId }));
  return buildId;
}

const chainTitles = (graph: ProvenanceGraph) => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.chains.map((chain) => chain.map((id) => {
    const node = byId.get(id)!;
    return node.kind === 'fragment' ? `${node.path}#${node.anchor}` : node.kind === 'section' ? `§${node.title}` : node.path;
  }).join(' > ')).sort();
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'graph-provenance-'));
  for (const [file, content] of Object.entries(files)) await put(file, content);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('provenance graph of a deliverable', () => {
  it('reads the frozen manifest: template, sections, pages and fragments, chain by chain', async () => {
    const buildId = await build();
    const graph = await loadProvenanceGraph(root, DELIVERABLE);

    expect(graph).toMatchObject({ source: 'frozen', buildId, root: DELIVERABLE, artifact: false });
    expect(graph.builds.map((entry) => entry.id)).toEqual([buildId]);
    expect(graph.nodes.filter((node) => node.col === 0).map((node) => [node.kind, node.path])).toEqual([
      ['template', 'templates/notes/basic-note.md'],
      ['context', 'build-context/rules/citations.md'],
    ]);
    expect(chainTitles(graph)).toEqual([
      `§Key Facts > ${COUT} > ${TARIFS} > ${OFFRE}#Tarifs`,
      `§Key Facts > ${CONCLUSIONS} > ${AUDIT}#Conclusions`,
      `§Summary > ${COUT} > ${TARIFS} > ${OFFRE}#Tarifs`,
      `§Summary > ${LOCALISATION} > ${OFFRE}#Localisation`,
    ]);
    const kinds = Object.fromEntries(graph.nodes.map((node) => [node.id, node.kind]));
    expect(kinds[COUT]).toBe('pivot');
    expect(kinds[TARIFS]).toBe('fiche');
    const tarifs = graph.nodes.find((node) => node.id === `fragment:${OFFRE}#Tarifs`)!;
    expect(tarifs).toMatchObject({ title: 'Offre cloud', status: 'unchanged', col: 4 });
    expect(tarifs.text).toContain('18 400');
    expect(graph.edges).toContainEqual({ source: 'templates/notes/basic-note.md', target: DELIVERABLE, kind: 'produces' });
    expect(graph.edges).toContainEqual({ source: 'build-context/rules/citations.md', target: 'templates/notes/basic-note.md', kind: 'uses' });
  });

  it('keeps the frozen text when the archive changed, and shows the current one live', async () => {
    await build();
    await put(OFFRE, (await readFile(path.join(root, OFFRE), 'utf8')).replace('18 400', '24 000'));

    const frozen = await loadProvenanceGraph(root, DELIVERABLE);
    const frozenTarifs = frozen.nodes.find((node) => node.id === `fragment:${OFFRE}#Tarifs`)!;
    expect(frozenTarifs).toMatchObject({ status: 'changed' });
    expect(frozenTarifs.text).toContain('18 400');
    expect(frozenTarifs.otherText).toContain('24 000');

    const live = await loadProvenanceGraph(root, DELIVERABLE, { mode: 'live' });
    const liveTarifs = live.nodes.find((node) => node.id === `fragment:${OFFRE}#Tarifs`)!;
    expect(live.source).toBe('live');
    expect(liveTarifs).toMatchObject({ status: 'changed' });
    expect(liveTarifs.text).toContain('24 000');
    expect(liveTarifs.otherText).toContain('18 400');
  });

  it('announces live what no longer resolves since the build', async () => {
    await build();
    await put(OFFRE, (await readFile(path.join(root, OFFRE), 'utf8')).replace('## Localisation', '## Hébergement'));

    const live = await loadProvenanceGraph(root, DELIVERABLE, { mode: 'live' });

    expect(live.degradations).toContain(`missing anchor: ${OFFRE}#Localisation`);
    expect(live.degradations).toContain(`no longer reached since the build: ${OFFRE}#Localisation`);
    expect(chainTitles(live).some((chain) => chain.includes('#Localisation'))).toBe(false);
    // The vanished proof stays drawn, as a broken chain from its section.
    const lost = live.nodes.find((node) => node.id === `fragment:${OFFRE}#Localisation`)!;
    expect(lost).toMatchObject({ status: 'missing' });
    expect(lost.text).toContain('Paris et Lille');
    expect(live.brokenChains).toHaveLength(1);
    expect(live.brokenChains[0]!.slice(1)).toEqual([LOCALISATION, `fragment:${OFFRE}#Localisation`]);
  });

  it('resolves an export artifact to its source deliverable and its frozen evidence', async () => {
    const buildId = await build();
    const deliverable = await readFile(path.join(root, DELIVERABLE), 'utf8');
    // An export keeps the front matter and strips every [src:] marker.
    await put('deliverables/notes/basic-note_v-02.export.md', deliverable.replace(/ \[src: [^\]]+\]/g, ''));

    const graph = await loadProvenanceGraph(root, 'deliverables/notes/basic-note_v-02.export.md');

    expect(graph).toMatchObject({ artifact: true, root: DELIVERABLE, source: 'frozen', buildId });
    expect(graph.chains).toHaveLength(4);
    expect(exportArtifactSourcePath('deliverables/a.export.polished.md')).toBe('deliverables/a.md');
    expect(exportArtifactSourcePath(DELIVERABLE)).toBeNull();
  });

  it('falls back to the live reading, announced, when the deliverable has no manifest', async () => {
    await put(DELIVERABLE, body);

    const graph = await loadProvenanceGraph(root, DELIVERABLE);

    expect(graph.source).toBe('live');
    expect(graph.buildId).toBeNull();
    expect(graph.degradations.some((line) => line.startsWith('no evidence_build_id'))).toBe(true);
    expect(graph.chains).toHaveLength(4);
  });
});

function call(url: string) {
  const sent: { status?: number; body?: unknown } = {};
  const req = { method: 'GET', url, headers: {} } as unknown as IncomingMessage;
  const deps: GraphRoutesDeps = {
    rootDir: root,
    language: () => 'en',
    workspaceNameFromEnv: () => 'test',
    sendJson: (_res, status, data) => { sent.status = status; sent.body = data; },
    sendGzippedHtml: async () => {},
  };
  return handleGraphRoutes(req, {} as ServerResponse, url.split('?')[0]!, deps).then(() => sent);
}

describe('/api/graph/provenance', () => {
  it('answers the graph, refuses a non-deliverable and reports a missing one', async () => {
    await build();
    expect((await call(`/api/graph/provenance?id=${encodeURIComponent(DELIVERABLE)}`)).status).toBe(200);
    expect(await call(`/api/graph/provenance?id=${encodeURIComponent('wiki/concepts/hebergement/cout.md')}`))
      .toMatchObject({ status: 400, body: { error: 'INVALID_DELIVERABLE' } });
    expect(await call(`/api/graph/provenance?id=${encodeURIComponent('deliverables/../.wikirc.yaml')}`))
      .toMatchObject({ status: 400 });
    expect(await call(`/api/graph/provenance?id=${encodeURIComponent('deliverables/none.md')}`))
      .toMatchObject({ status: 404, body: { error: 'DELIVERABLE_NOT_FOUND' } });
  });
});

describe('/provenance page', () => {
  it('is served as an HTML page and reads its data from the API, never hard-coded', async () => {
    const sent: { html?: string } = {};
    const req = { method: 'GET', url: '/provenance?id=deliverables%2Fx.md', headers: {} } as unknown as IncomingMessage;
    await handleGraphRoutes(req, {} as ServerResponse, '/provenance', {
      rootDir: root,
      language: () => 'en',
      workspaceNameFromEnv: () => 'test',
      sendJson: () => {},
      sendGzippedHtml: async (_req, _res, html) => { sent.html = html; },
    });

    expect(sent.html).toContain('<title>Provenance</title>');
    expect(sent.html).toContain("'/api/graph/provenance?id='+encodeURIComponent(target)");
    for (const column of ['Template &amp; context', 'Deliverable', 'Pivots', 'TAXO fiches', 'Archives']) {
      expect(sent.html).toContain(column);
    }
    expect(sent.html).toContain('id="mode-frozen"');
    expect(sent.html).toContain('id="mode-live"');
    // Local-first: no font or script fetched from another host.
    expect(sent.html).not.toMatch(/https?:\/\//);
  });

  it('renders the real payload: cards, rows, badges, banner and the detail of a fragment', async () => {
    await build();
    await put(OFFRE, (await readFile(path.join(root, OFFRE), 'utf8')).replace('18 400', '24 000'));
    const payload = await loadProvenanceGraph(root, DELIVERABLE);
    const out = runPage(PROVENANCE_SCRIPT, payload, `fragment:${OFFRE}#Tarifs`);

    expect(out.title).toBe('Basic Note');
    expect(out.columns[0]).toEqual(['Template · Basic Note', 'Build context · Citation rules']);
    expect(out.columns[1]).toEqual(['Deliverable · Basic Note']);
    expect(out.columns[2]).toEqual([`Concept pivot · Coût d'hébergement`]);
    expect(out.columns[4]).toEqual(['Archive · Offre cloud', 'Archive · Audit SecNum']);
    expect(out.rows).toContain('§ Summary2 proofs');
    expect(out.rows).toContain('#Tarifschanged since build');
    expect(out.banner).toContain('Frozen evidence of build');
    expect(out.banner).toContain('1 fragment has changed');
    expect(out.detail).toContain('Forfait annuel 18 400 EUR');
    expect(out.detail).toContain('The current archive now reads:');
    expect(out.detail).toContain('Forfait annuel 24 000 EUR');
    expect(out.detail).toContain('2 chains through here');
    expect(out.detail).toContain('Add to Donna');
  });
});

/** A minimal DOM, enough for the page script to render into. */
function runPage(script: string, payload: ProvenanceGraph, select: string) {
  type El = {
    id?: string; className: string; innerHTML: string; textContent: string; hidden: boolean; disabled: boolean;
    tabIndex: number; value: string; dataset: Record<string, string>; style: { setProperty(): void };
    classList: { toggle(): void; add(): void }; children: El[]; parent?: El;
    appendChild(child: El): El; insertAdjacentHTML(_: string, html: string): void; querySelector(): El | null;
    querySelectorAll(): El[]; remove(): void; addEventListener(): void; setAttribute(): void;
    getBoundingClientRect(): { left: number; right: number; top: number; height: number };
  };
  const make = (id?: string): El => {
    const el: El = {
      id, className: '', innerHTML: '', textContent: '', hidden: false, disabled: false, tabIndex: 0, value: '',
      dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {} }, children: [],
      appendChild(child) { child.parent = el; el.children.push(child); return child; },
      insertAdjacentHTML(_, html) { el.innerHTML += html; },
      querySelector() { return el.children.find((child) => child.className.startsWith('node')) ?? null; },
      querySelectorAll() { return []; },
      remove() {}, addEventListener() {}, setAttribute() {},
      getBoundingClientRect() { return { left: 0, right: 10, top: 0, height: 10 }; },
    };
    return el;
  };
  const byId = new Map<string, El>();
  const document = {
    title: '',
    documentElement: { classList: { toggle() {} } },
    getElementById: (id: string) => { if (!byId.has(id)) byId.set(id, make(id)); return byId.get(id)!; },
    createElement: () => make(),
    addEventListener() {},
  };
  const window = { parent: null as unknown, addEventListener() {} };
  window.parent = window;
  const run = new Function('document', 'window', 'location', 'localStorage', 'matchMedia', 'fetch', 'requestAnimationFrame', 'payload', 'select',
    `${script.replace(/\nload\(\);\s*$/, '')}
     data=payload;byId=new Map(data.nodes.map(n=>[n.id,n]));selected=select;render();
     return true;`);
  run(document, window, { search: `?id=${encodeURIComponent(DELIVERABLE)}`, origin: 'http://x' },
    { getItem: () => null }, () => ({ matches: false }), async () => ({}), () => 0, payload, select);
  const text = (el: El) => el.innerHTML.replace(/<[^>]+>/g, '');
  const cardLabel = (el: El) => {
    const kind = /<div class="k">([^<]*)<\/div>/.exec(el.innerHTML)?.[1] ?? '';
    const title = /<div class="t">([^<]*)<\/div>/.exec(el.innerHTML)?.[1] ?? '';
    return `${kind} · ${title}`.replace(/&#39;/g, "'");
  };
  const columns = [0, 1, 2, 3, 4].map((c) => byId.get(`col-${c}`)!.children.map(cardLabel));
  const rows = [...byId.values()].flatMap((el) => el.children).flatMap((card) => card.children).flatMap((rows) => rows.children)
    .map((row) => text(row));
  return {
    title: byId.get('title')!.textContent,
    columns,
    rows,
    banner: text(byId.get('banner')!),
    detail: text(byId.get('detail')!).replace(/&#39;/g, "'"),
  };
}

describe('announcements on a frozen build', () => {
  it('flags a page the build went through that no longer exists, and a whole-file proof', async () => {
    await build();
    await rm(path.join(root, LOCALISATION));

    const graph = await loadProvenanceGraph(root, DELIVERABLE);

    expect(graph.source).toBe('frozen');
    expect(graph.nodes.find((node) => node.id === LOCALISATION)).toMatchObject({ status: 'missing' });
    expect(graph.degradations).toContain(`page no longer exists since the build: ${LOCALISATION}`);
    // The frozen proof itself is intact: the archive still holds the passage.
    expect(graph.nodes.find((node) => node.id === `fragment:${OFFRE}#Localisation`)).toMatchObject({ status: 'unchanged' });
  });
});

describe('announcements on a live reading', () => {
  it('flags a page that vanished since the build on the broken chain it explains', async () => {
    await build();
    await rm(path.join(root, LOCALISATION));

    const live = await loadProvenanceGraph(root, DELIVERABLE, { mode: 'live' });

    expect(live.brokenChains.some((chain) => chain.includes(LOCALISATION))).toBe(true);
    expect(live.nodes.find((node) => node.id === LOCALISATION)).toMatchObject({ status: 'missing' });
    expect(live.degradations).toContain(`page no longer exists since the build: ${LOCALISATION}`);
  });
});
