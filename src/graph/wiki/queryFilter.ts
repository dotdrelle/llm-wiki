import type { WikiGraphEdge, WikiGraphNode, WikiGraphRelationType } from './projection.ts';
import { WIKI_GRAPH_RELATION_LABELS } from './projection.ts';

/*
 The graph search is a RELATION filter, not a document finder.

 Typing "ana" must narrow the edges that bear on "ana" (a relation to an
 Anaplan page), not pick one page and forget the rest. The predicate is applied
 once, server-side, BEFORE the projection: the same code then derives both the
 leaf edges and the concept/community edges, so the two levels can never
 disagree about what the query matched — the failure mode the three surfaces
 (index, canvas, inspector) already taught us to avoid.

 The match is accent- and case-insensitive and reads the fields a reader would
 search by: title, id, `subject`, OKF `type`, and every `tags` value. An edge is
 kept when EITHER endpoint matches (so an isolated "Anaplan" still shows its
 relations) or when the relation label itself matches; the endpoints of a kept
 edge are always pulled back in, otherwise a type filter could hide one end and
 silently delete the relation.
 */

export function normalizeGraphQuery(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

type SearchableNode = Pick<WikiGraphNode, 'id' | 'type'> & {
  title?: string | null;
  subject?: string | null;
  okfType?: string | null;
  tags?: string[];
};

function nodeSearchText(node: SearchableNode): string {
  return normalizeGraphQuery([
    node.title,
    node.id,
    node.subject,
    node.okfType,
    ...(Array.isArray(node.tags) ? node.tags : []),
  ].filter(Boolean).join(' '));
}

export function filterGraphByQuery<N extends SearchableNode>(
  nodes: N[],
  edges: WikiGraphEdge[],
  query: string,
): { nodes: N[]; edges: WikiGraphEdge[] } {
  const q = normalizeGraphQuery(query);
  if (!q) return { nodes, edges };

  const matchedNodeIds = new Set(nodes.filter((node) => nodeSearchText(node).includes(q)).map((node) => node.id));
  const relationMatches = (type: WikiGraphRelationType) =>
    normalizeGraphQuery(WIKI_GRAPH_RELATION_LABELS[type] ?? type).includes(q);

  const keptEdges = edges.filter((edge) =>
    matchedNodeIds.has(edge.from) || matchedNodeIds.has(edge.to) || relationMatches(edge.type));

  const keptNodeIds = new Set(matchedNodeIds);
  for (const edge of keptEdges) {
    keptNodeIds.add(edge.from);
    keptNodeIds.add(edge.to);
  }

  return { nodes: nodes.filter((node) => keptNodeIds.has(node.id)), edges: keptEdges };
}
