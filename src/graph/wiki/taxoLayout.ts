import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { TaxoGraph } from './taxoGraph.ts';

/**
 * Positions of the three force-laid TAXO views, computed once per corpus.
 *
 * The browser graph is Canvas-only and never loads D3: the force simulation
 * runs here, in Node, with the same forces the TAXO prototype tuned
 * (`_tmp/taxo/graph.html`), and ships settled coordinates. The Focus view is a
 * pure ring geometry and is laid out by the browser. Positions are cached with
 * the graph itself (same etag), so a revision that changes nothing re-lays
 * nothing.
 */
export type TaxoLayout = Record<'family' | 'concepts' | 'full', Record<string, [number, number]>>;

type SimNode = { id: string; type: string; family?: string; count?: number; nsrc: number; x?: number; y?: number };
type SimLink = { source: string | SimNode; target: string | SimNode; kind: string; w?: number };

const radius = (n: SimNode) => n.type === 'family' ? 16 + Math.sqrt(n.count ?? 0) * 4 : n.type === 'concept' ? 3.5 + Math.sqrt(n.nsrc) * 1.6 : 4.5;

function settle(nodes: SimNode[], configure: (sim: any) => void): Record<string, [number, number]> {
  const sim = forceSimulation(nodes).alphaDecay(0.035).stop();
  configure(sim);
  for (let i = 0; i < 300; i += 1) sim.tick();
  return Object.fromEntries(nodes.map((n) => [n.id, [Math.round(n.x ?? 0), Math.round(n.y ?? 0)]]));
}

/** Clear space kept between two family halos, in layout units. */
const FAMILY_GAP = 40;

/*
 The forces settle each family's concepts around it, but nothing keeps two
 families' halos apart: on a real corpus they overlapped by ~70 units and the
 view read as one tangle. Each family is moved RIGID — its centre and its
 concepts by the same offset, so its own shape is kept — away from any family
 whose halo it touches, until every pair is separated, then recentred.
 */
function separateFamilies(positions: Record<string, [number, number]>, families: string[], concepts: Array<{ id: string; family?: string }>): void {
  const members = new Map(families.map((f) => [f, concepts.filter((c) => c.family === f).map((c) => c.id)]));
  const reach = (f: string) => {
    const [x, y] = positions[`f:${f}`]!;
    return Math.max(30, ...members.get(f)!.map((id) => Math.hypot(positions[id]![0] - x, positions[id]![1] - y) + 18));
  };
  const move = (f: string, dx: number, dy: number) => {
    for (const id of [`f:${f}`, ...members.get(f)!]) positions[id] = [positions[id]![0] + dx, positions[id]![1] + dy];
  };
  const radius = new Map(families.map((f) => [f, reach(f)]));
  for (let pass = 0; pass < 300; pass += 1) {
    let moved = false;
    for (let i = 0; i < families.length; i += 1) for (let j = i + 1; j < families.length; j += 1) {
      const a = families[i]!, b = families[j]!;
      const [ax, ay] = positions[`f:${a}`]!, [bx, by] = positions[`f:${b}`]!;
      let dx = bx - ax, dy = by - ay;
      let distance = Math.hypot(dx, dy);
      if (distance < 1e-6) { dx = 1; dy = 0; distance = 1; }
      const overlap = radius.get(a)! + radius.get(b)! + FAMILY_GAP - distance;
      if (overlap <= 0) continue;
      const push = overlap / 2 + 0.5, ux = dx / distance, uy = dy / distance;
      move(a, -ux * push, -uy * push);
      move(b, ux * push, uy * push);
      moved = true;
    }
    if (!moved) break;
  }
  const ids = Object.keys(positions);
  const cx = ids.reduce((sum, id) => sum + positions[id]![0], 0) / ids.length;
  const cy = ids.reduce((sum, id) => sum + positions[id]![1], 0) / ids.length;
  for (const id of ids) positions[id] = [Math.round(positions[id]![0] - cx), Math.round(positions[id]![1] - cy)];
}

export function layoutTaxoGraph(graph: TaxoGraph): TaxoLayout {
  const concepts = graph.nodes.filter((n) => n.type === 'concept');
  const sources = graph.nodes.filter((n) => n.type === 'source');
  const bip = new Map(graph.nodes.map((n) => [n.id, new Set<string>()]));
  graph.links.forEach((l) => { bip.get(l.source)?.add(l.target); bip.get(l.target)?.add(l.source); });
  const nsrc = (id: string) => bip.get(id)?.size ?? 0;

  // Concepts are linked when one fiche cites both; families when they share a fiche.
  const shared = new Map<string, number>();
  for (const s of sources) {
    const cs = [...(bip.get(s.id) ?? [])].sort();
    for (let i = 0; i < cs.length; i += 1) for (let j = i + 1; j < cs.length; j += 1) {
      const key = `${cs[i]}|${cs[j]}`;
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const famSources = new Map(graph.families.map((f) => [f, new Set<string>()]));
  concepts.forEach((c) => bip.get(c.id)?.forEach((sid) => famSources.get(c.family ?? '')?.add(sid)));

  const anchor: Record<string, { x: number; y: number }> = {};
  graph.families.forEach((f, i) => {
    const a = (i / graph.families.length) * 2 * Math.PI - Math.PI / 2;
    anchor[f] = { x: Math.cos(a) * 190, y: Math.sin(a) * 150 };
  });

  const conceptNodes = () => concepts.map((c) => ({ id: c.id, type: 'concept', family: c.family, nsrc: nsrc(c.id) }));

  const famNodes: SimNode[] = graph.families.map((f) => ({
    id: `f:${f}`, type: 'family', family: f, nsrc: famSources.get(f)?.size ?? 0,
    count: concepts.filter((c) => c.family === f).length,
  }));
  const crossLinks: SimLink[] = [];
  for (let i = 0; i < graph.families.length; i += 1) for (let j = i + 1; j < graph.families.length; j += 1) {
    const a = famSources.get(graph.families[i]!)!, b = famSources.get(graph.families[j]!)!;
    const w = [...a].filter((x) => b.has(x)).length;
    if (w) crossLinks.push({ source: `f:${graph.families[i]}`, target: `f:${graph.families[j]}`, w, kind: 'cross' });
  }
  const familyNodes = [...famNodes, ...conceptNodes()];
  const byId = new Map(familyNodes.map((n) => [n.id, n]));
  const familyLinks: SimLink[] = [...crossLinks, ...concepts.map((c) => ({ source: c.id, target: `f:${c.family}`, kind: 'member' }))];
  const family = settle(familyNodes, (sim) => sim
    .force('link', forceLink(familyLinks).id((d: SimNode) => d.id)
      .distance((l: SimLink) => l.kind === 'cross' ? 260 : 60 + radius(byId.get((l.target as SimNode).id ?? (l.target as string))!))
      .strength((l: SimLink) => l.kind === 'cross' ? 0.04 + (l.w ?? 0) * 0.01 : 0.9))
    .force('charge', forceManyBody().strength((d: SimNode) => d.type === 'family' ? -1100 : -70))
    .force('collide', forceCollide((d: SimNode) => radius(d) + (d.type === 'family' ? 20 : 12)))
    .force('x', forceX(0).strength(0.04)).force('y', forceY(0).strength(0.05)));

  separateFamilies(family, graph.families, concepts);

  const coLinks: SimLink[] = [...shared].map(([key, w]) => { const [a, b] = key.split('|'); return { source: a!, target: b!, w, kind: 'co' }; });
  const conceptsView = settle(conceptNodes(), (sim) => sim
    .force('link', forceLink(coLinks).id((d: SimNode) => d.id).distance(70).strength((l: SimLink) => 0.25 + (l.w ?? 0) * 0.2))
    .force('charge', forceManyBody().strength(-180))
    .force('collide', forceCollide((d: SimNode) => radius(d) + 16))
    .force('x', forceX((d: SimNode) => anchor[d.family ?? '']?.x ?? 0).strength(0.12))
    .force('y', forceY((d: SimNode) => anchor[d.family ?? '']?.y ?? 0).strength(0.12)));

  const fullNodes: SimNode[] = [...conceptNodes(), ...sources.map((s) => ({ id: s.id, type: 'source', nsrc: nsrc(s.id) }))];
  const citeLinks: SimLink[] = graph.links.map((l) => ({ source: l.source, target: l.target, kind: 'cite' }));
  const full = settle(fullNodes, (sim) => sim
    .force('link', forceLink(citeLinks).id((d: SimNode) => d.id).distance(70).strength(0.6))
    .force('charge', forceManyBody().strength((d: SimNode) => d.type === 'concept' ? -240 : -100))
    .force('collide', forceCollide((d: SimNode) => radius(d) + 12))
    .force('x', forceX(0).strength(0.05)).force('y', forceY(0).strength(0.06)));

  return { family, concepts: conceptsView, full };
}
