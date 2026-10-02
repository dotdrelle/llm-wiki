import type { QueryGraphNode, QueryEdgeType } from './queryGraph.ts';

export type PortableGraphEdge = { from: string; to: string; type: QueryEdgeType };

type Point = { x: number; y: number };

const nodeColors: Record<string, string> = {
  concept: '#75aff5',
  source: '#e4b44c',
  'raw-source': '#e4b44c',
  template: '#b08be8',
  deliverable: '#74c365',
};

const edgeColors: Record<QueryEdgeType, string> = {
  citation: '#9f7aea',
  produces: '#ed7d4d',
  wiki_link: '#72a7e8',
  shared_subject: '#44c2c7',
  shared_tag: '#74c365',
  co_cited: '#d08cff',
};

const edgeLabels: Record<QueryEdgeType, string> = {
  citation: 'Citation',
  produces: 'Produces',
  wiki_link: 'Link',
  shared_subject: 'Context',
  shared_tag: 'Tag',
  co_cited: 'Co-cited',
};

function escapeSvg(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[character] ?? character));
}

function shortLabel(value: string, max = 30): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function typeLabel(type: string): string {
  return type.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function cardWidth(node: QueryGraphNode): number {
  return Math.min(250, Math.max(154, 92 + shortLabel(node.label, 34).length * 5.4));
}

/** Static MCP rendering that follows the serve graph's dark canvas and cards. */
export function renderPortableGraphSvg(
  nodes: QueryGraphNode[],
  edges: PortableGraphEdge[],
  options: { selector?: string | null; focusNode?: string | null } = {},
): string {
  const width = 1200;
  const height = 780;
  const graphTop = 128;
  const graphBottom = 654;
  const center = { x: width / 2, y: (graphTop + graphBottom) / 2 + 8 };
  const focus = options.focusNode && nodes.some((node) => node.id === options.focusNode)
    ? options.focusNode
    : [...nodes].sort((a, b) => b.tags.length - a.tags.length || a.id.localeCompare(b.id))[0]?.id;
  const positions = new Map<string, Point>();

  if (nodes.length === 1) {
    positions.set(nodes[0].id, center);
  } else {
    if (focus) positions.set(focus, center);
    const others = nodes.filter((node) => node.id !== focus);
    const radius = Math.min(315, Math.max(180, 66 + Math.sqrt(others.length) * 62));
    others.forEach((node, index) => {
      const angle = index * 2.399963 + Math.PI / 2;
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * Math.min(radius, width / 2 - 150),
        y: center.y + Math.sin(angle) * Math.min(radius * 0.72, 220),
      });
    });
  }

  const defs = `<defs>
    <linearGradient id="wiki-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101827"/><stop offset=".55" stop-color="#0a0e18"/><stop offset="1" stop-color="#06080d"/></linearGradient>
    <filter id="wiki-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <marker id="wiki-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8fa1b5"/></marker>
  </defs>`;

  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const color = edgeColors[edge.type] ?? '#8fa1b5';
    const curve = (to.x - from.x) * 0.08;
    const cx = (from.x + to.x) / 2 - (to.y - from.y) * 0.10;
    const cy = (from.y + to.y) / 2 + (to.x - from.x) * 0.10;
    const labelX = (from.x + to.x) / 2 - (to.y - from.y) * 0.06;
    const labelY = (from.y + to.y) / 2 + (to.x - from.x) * 0.06;
    return `<path d="M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${(cx + curve).toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity=".62" marker-end="url(#wiki-arrow)"/><text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${color}" font-family="ui-sans-serif,system-ui" font-size="10" text-anchor="middle" paint-order="stroke" stroke="#08111d" stroke-width="4">${escapeSvg(edgeLabels[edge.type] ?? edge.type)}</text>`;
  }).join('');

  const nodeSvg = nodes.map((node) => {
    const point = positions.get(node.id);
    if (!point) return '';
    const selected = node.id === focus;
    const color = nodeColors[node.type] ?? '#8fa1b5';
    const w = selected ? Math.max(cardWidth(node), 220) : cardWidth(node);
    const h = selected ? 74 : 62;
    const x = point.x - w / 2;
    const y = point.y - h / 2;
    const path = shortLabel(node.id, 38);
    return `<g>
      ${selected ? `<rect x="${(x - 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="${(w + 14).toFixed(1)}" height="${(h + 14).toFixed(1)}" rx="15" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="2" filter="url(#wiki-glow)"/>` : ''}
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="10" fill="#101722" stroke="${color}" stroke-opacity="${selected ? '1' : '.62'}" stroke-width="${selected ? '2' : '1'}"/>
      <rect x="${(x + 5).toFixed(1)}" y="${(y + 9).toFixed(1)}" width="3" height="${h - 18}" rx="1.5" fill="${color}"/>
      <text x="${(x + 17).toFixed(1)}" y="${(y + 21).toFixed(1)}" fill="#edf3fb" font-family="ui-sans-serif,system-ui" font-size="${selected ? '13' : '11.5'}" font-weight="600">${escapeSvg(shortLabel(node.label, 32))}</text>
      <text x="${(x + 17).toFixed(1)}" y="${(y + 38).toFixed(1)}" fill="${color}" font-family="ui-sans-serif,system-ui" font-size="10">${escapeSvg(typeLabel(node.type))}</text>
      <text x="${(x + 17).toFixed(1)}" y="${(y + (selected ? 57 : 54)).toFixed(1)}" fill="#9fb0c3" font-family="ui-monospace,SFMono-Regular,monospace" font-size="9">${escapeSvg(path)}</text>
    </g>`;
  }).join('');

  const legend = (Object.keys(edgeLabels) as QueryEdgeType[]).map((type) => `<span style="display:inline-flex;align-items:center;gap:5px"><i style="display:inline-block;width:18px;height:2px;background:${edgeColors[type]}"></i>${escapeSvg(edgeLabels[type])}</span>`).join('');
  const selector = options.selector ? String(options.selector) : 'workspace overview';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="llm-wiki knowledge graph" preserveAspectRatio="xMidYMid meet">${defs}<rect width="100%" height="100%" fill="url(#wiki-bg)"/>
    <text x="28" y="36" fill="#f4f7fc" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="700">LLM-WIKI</text>
    <text x="28" y="61" fill="#75aff5" font-family="ui-sans-serif,system-ui" font-size="12" font-weight="700" letter-spacing=".08em">KNOWLEDGE GRAPH</text>
    <text x="1172" y="36" fill="#9fb0c3" font-family="ui-sans-serif,system-ui" font-size="11" text-anchor="end">${escapeSvg(selector)} · ${nodes.length} nodes · ${edges.length} edges</text>
    <line x1="28" y1="82" x2="1172" y2="82" stroke="#26384d"/>
    <rect x="20" y="102" width="1160" height="574" rx="12" fill="#0b111b" fill-opacity=".48" stroke="#26384d"/>
    ${edgeSvg}${nodeSvg}
    <g transform="translate(36 716)"><rect width="1128" height="35" rx="8" fill="#08131e" fill-opacity=".92" stroke="#26384d"/><foreignObject x="14" y="8" width="1100" height="22"><div xmlns="http://www.w3.org/1999/xhtml" style="font:10px ui-sans-serif,system-ui;color:#9fb0c3;display:flex;gap:18px;align-items:center;flex-wrap:wrap">${legend}</div></foreignObject></g>
  </svg>`;
}
