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

    const live = await loadProvenanceGraph(root, DELIVERABLE, { mode: 'live' });
    const liveTarifs = live.nodes.find((node) => node.id === `fragment:${OFFRE}#Tarifs`)!;
    expect(live.source).toBe('live');
    expect(liveTarifs).toMatchObject({ status: 'changed' });
    expect(liveTarifs.text).toContain('24 000');
  });

  it('announces live what no longer resolves since the build', async () => {
    await build();
    await put(OFFRE, (await readFile(path.join(root, OFFRE), 'utf8')).replace('## Localisation', '## Hébergement'));

    const live = await loadProvenanceGraph(root, DELIVERABLE, { mode: 'live' });

    expect(live.degradations).toContain(`missing anchor: ${OFFRE}#Localisation`);
    expect(live.degradations).toContain(`no longer reached since the build: ${OFFRE}#Localisation`);
    expect(chainTitles(live).some((chain) => chain.includes('#Localisation'))).toBe(false);
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

describe('Provenance view in the browser', () => {
  it('lays the deliverable out in five columns, rows following the chains', async () => {
    await build();
    const payload = await loadProvenanceGraph(root, DELIVERABLE);
    const { provenanceScript } = await import('../src/graph/wiki/ui/provenance/provenanceScript.ts');
    const element = { addEventListener() {}, classList: { toggle() {} }, hidden: false };
    const run = new Function('document', 'payload', `let view='provenance',sel=null;const manual={};const esc=s=>String(s);
      ${provenanceScript()}
      prov=payload;provById=new Map(prov.nodes.map(n=>[n.id,n]));
      const D=provenanceData();
      return {nodes:D.nodes.map(n=>({id:n.id,x:n.x,y:n.y,prov:n.prov})),links:D.links.length,
        around:provNeighbors('fragment:${OFFRE}#Localisation').sort()};`);
    const out = run({ querySelector: () => element }, payload) as {
      nodes: Array<{ id: string; x: number; y: number; prov: boolean }>; links: number; around: string[];
    };
    const at = (id: string) => out.nodes.find((node) => node.id === id)!;

    expect(out.nodes.every((node) => node.prov)).toBe(true);
    expect([at('templates/notes/basic-note.md').x, at(DELIVERABLE).x, at(COUT).x, at(TARIFS).x, at(`fragment:${OFFRE}#Tarifs`).x])
      .toEqual([-570, -285, 0, 285, 570]);
    // Summary's evidence comes before Key Facts' own, top to bottom.
    expect(at(`fragment:${OFFRE}#Tarifs`).y).toBeLessThan(at(`fragment:${AUDIT}#Conclusions`).y);
    expect(out.links).toBe(payload.edges.length);
    const summary = payload.nodes.find((node) => node.kind === 'section' && node.title === 'Summary')!.id;
    expect(out.around).toEqual([`fragment:${OFFRE}#Localisation`, LOCALISATION, summary].sort());
  });

  it('offers the view only when the page was opened for a deliverable', async () => {
    const { renderWikiGraphV2 } = await import('../src/graph/wiki/graphApp.ts');
    const html = renderWikiGraphV2();

    expect(html).toContain('<button type="button" id="v-provenance" aria-pressed="false" hidden>Provenance</button>');
    expect(html).toContain('id="prov-mode" hidden');
    expect(html).toContain("new URLSearchParams(location.search).get('provenance')");
    expect(html).toContain('initProvenance();\nstartRevisionFeed();\nloadTaxo(true);');
  });
});
