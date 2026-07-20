import { createHash } from 'node:crypto';
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeType,
  WikiGraphRelationType,
} from './projection.ts';

export type CommunityAssignment = {
  communityId: string;
  communityLabel: string;
  assignment: 'explicit' | 'inherited' | 'fallback';
};

export type WikiGraphCommunity = {
  id: string;
  label: string;
  nodeIds: string[];
  documentCount: number;
  conceptCount: number;
  sourceCount: number;
  internalRelations: number;
  externalRelations: number;
};

export type WikiGraphCommunityEdge = {
  from: string;
  to: string;
  count: number;
  relations: Partial<Record<WikiGraphRelationType, number>>;
};

export type CommunityProjection = {
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  topologyEtag: string;
};

type ExplicitCommunity = { label: string } | undefined;

export function communityId(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'ungrouped';
}

function title(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function conceptFolder(nodeId: string): string | undefined {
  const parts = nodeId.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4
    ? parts[2]
    : undefined;
}

function assigned(
  label: string,
  assignment: CommunityAssignment['assignment'],
): CommunityAssignment {
  return { communityId: communityId(label), communityLabel: label, assignment };
}

function winningCommunity(
  candidates: CommunityAssignment[],
  strict: boolean,
): CommunityAssignment | undefined {
  if (candidates.length === 0) return undefined;
  const counts = new Map<string, { count: number; label: string }>();
  for (const candidate of candidates) {
    const current = counts.get(candidate.communityId);
    counts.set(candidate.communityId, {
      count: (current?.count ?? 0) + 1,
      label: current?.label ?? candidate.communityLabel,
    });
  }
  const ranked = [...counts]
    .sort(([idA, a], [idB, b]) => b.count - a.count || idA.localeCompare(idB));
  const winner = ranked[0];
  if (!winner || (strict && winner[1].count <= candidates.length / 2)) return undefined;
  return assigned(winner[1].label, 'inherited');
}

function connectedAssignments(
  nodeId: string,
  edges: WikiGraphEdge[],
  assignments: Map<string, CommunityAssignment>,
  relationTypes: Set<WikiGraphRelationType>,
  neighborFilter: (neighborId: string) => boolean = () => true,
): CommunityAssignment[] {
  const result: CommunityAssignment[] = [];
  const seenNeighbors = new Set<string>();
  for (const edge of edges) {
    if (!relationTypes.has(edge.type)) continue;
    const neighborId = edge.from === nodeId ? edge.to : edge.to === nodeId ? edge.from : null;
    if (!neighborId || seenNeighbors.has(neighborId) || !neighborFilter(neighborId)) continue;
    const community = assignments.get(neighborId);
    if (community) {
      seenNeighbors.add(neighborId);
      result.push(community);
    }
  }
  return result;
}

export function assignGraphCommunities(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  explicitCommunities: Map<string, ExplicitCommunity>,
  fallbackCommunityLabel = 'Ungrouped',
): WikiGraphNode[] {
  const assignments = new Map<string, CommunityAssignment>();

  // Pass 1: explicit frontmatter. `community` precedence is resolved by the
  // projection before this pure assignment function receives the label.
  for (const node of nodes) {
    const explicit = explicitCommunities.get(node.id);
    if (explicit?.label.trim()) assignments.set(node.id, assigned(explicit.label.trim(), 'explicit'));
  }

  // Pass 2: concept folder.
  for (const node of nodes) {
    if (assignments.has(node.id)) continue;
    const folder = conceptFolder(node.id);
    if (folder) assignments.set(node.id, assigned(title(folder), 'explicit'));
  }

  // Pass 3: sources inherit the plurality of already-assigned concepts.
  for (const node of nodes) {
    if (assignments.has(node.id) || !['raw-source', 'wiki-source'].includes(node.type)) continue;
    const candidates = connectedAssignments(
      node.id,
      edges.filter((edge) => edge.to === node.id),
      assignments,
      new Set(['generated_from', 'cites']),
      (id) => Boolean(conceptFolder(id)),
    );
    const winner = winningCommunity(candidates, false);
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 4: templates and build contexts require a strict majority.
  for (const node of nodes) {
    if (assignments.has(node.id) || !['template', 'build-context'].includes(node.type)) continue;
    const winner = winningCommunity(
      connectedAssignments(
        node.id,
        edges,
        assignments,
        new Set(['uses_template', 'uses_context', 'produces']),
      ),
      true,
    );
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 5: deliverables inherit the plurality of already-assigned producers.
  for (const node of nodes) {
    if (assignments.has(node.id) || node.type !== 'deliverable') continue;
    const producers = edges
      .filter((edge) => edge.type === 'produces' && edge.to === node.id)
      .map((edge) => assignments.get(edge.from))
      .filter((value): value is CommunityAssignment => Boolean(value));
    const winner = winningCommunity(producers, false);
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 6: stable fallback id, configurable display label.
  return nodes.map((node) => ({
    ...node,
    community: assignments.get(node.id) ?? {
      communityId: 'ungrouped',
      communityLabel: fallbackCommunityLabel,
      assignment: 'fallback',
    },
  }));
}

function isConcept(node: WikiGraphNode): boolean {
  return Boolean(conceptFolder(node.id));
}

function isSource(type: WikiGraphNodeType): boolean {
  return type === 'raw-source' || type === 'wiki-source';
}

export function topologyEtag(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
): string {
  const nodeIds = nodes.map((node) => node.id).sort();
  const edgeTuples = edges
    .map((edge) => [edge.from, edge.to, edge.type] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const assignmentTuples = nodes
    .map((node) => [node.id, node.community.communityId] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha1')
    .update(JSON.stringify([nodeIds, edgeTuples, assignmentTuples]))
    .digest('hex');
}

export function createCommunityProjection(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
): CommunityProjection {
  const buckets = new Map<string, WikiGraphNode[]>();
  for (const node of nodes) {
    const bucket = buckets.get(node.community.communityId) ?? [];
    bucket.push(node);
    buckets.set(node.community.communityId, bucket);
  }

  const communityByNode = new Map(nodes.map((node) => [node.id, node.community.communityId]));
  const internalCounts = new Map<string, number>();
  const externalCounts = new Map<string, number>();
  const aggregate = new Map<string, WikiGraphCommunityEdge>();
  for (const edge of edges) {
    const from = communityByNode.get(edge.from);
    const to = communityByNode.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      internalCounts.set(from, (internalCounts.get(from) ?? 0) + 1);
      continue;
    }
    externalCounts.set(from, (externalCounts.get(from) ?? 0) + 1);
    externalCounts.set(to, (externalCounts.get(to) ?? 0) + 1);
    const key = JSON.stringify([from, to]);
    const current = aggregate.get(key) ?? { from, to, count: 0, relations: {} };
    current.count += 1;
    current.relations[edge.type] = (current.relations[edge.type] ?? 0) + 1;
    aggregate.set(key, current);
  }

  const communities = [...buckets].map(([id, members]): WikiGraphCommunity => {
    const sortedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id));
    return {
      id,
      label: sortedMembers[0]?.community.communityLabel ?? id,
      nodeIds: sortedMembers.map((node) => node.id),
      documentCount: sortedMembers.length,
      conceptCount: sortedMembers.filter(isConcept).length,
      sourceCount: sortedMembers.filter((node) => isSource(node.type)).length,
      internalRelations: internalCounts.get(id) ?? 0,
      externalRelations: externalCounts.get(id) ?? 0,
    };
  }).sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label));

  const communityEdges = [...aggregate.values()]
    .map((edge) => ({
      ...edge,
      relations: Object.fromEntries(
        Object.entries(edge.relations).sort(([a], [b]) => a.localeCompare(b)),
      ) as Partial<Record<WikiGraphRelationType, number>>,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    communities,
    communityEdges,
    topologyEtag: topologyEtag(nodes, edges),
  };
}
