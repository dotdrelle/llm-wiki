import { createHash } from 'node:crypto';
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeType,
  WikiGraphRelationType,
} from './projection.ts';
import { UNCLASSIFIED_ID, UNCLASSIFIED_LABEL } from '../../ingest/conceptGrid.ts';

/**
 * Community assignment for the flat graph.
 *
 * There is no registry and no domain layer. A node's community is its CONCEPT
 * FOLDER (for a concept leaf), or a fixed group named after its node type for
 * the non-concept surfaces. The transverse edges — an entity via a shared
 * `subject`, a theme via a shared `tags` entry — are computed here, never
 * materialized anywhere.
 */
export type CommunityAssignment = {
  communityId: string;
  communityLabel: string;
  assignment: 'seed' | 'fallback';
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
  relations: Partial<Record<WikiGraphRelationType | SharedRelationKind, number>>;
};

/** The transverse axes a leaf can be grouped by, and the cross-edge kinds. */
export type GroupAxis = 'concept' | 'subject' | 'type' | 'tag';

export type SharedRelationKind = 'shared_subject' | 'shared_tag' | 'shared_folder' | 'shared_type' | 'shared_member';

export type CommunityProjection = {
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  topologyEtag: string;
};

export function communityId(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || UNCLASSIFIED_ID;
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

const TYPE_LABELS: Partial<Record<WikiGraphNodeType, string>> = {
  'raw-source': 'Raw sources',
  'wiki-source': 'Sources',
  'template': 'Templates',
  'build-context': 'Build context',
  'deliverable': 'Deliverables',
};

function assigned(label: string, assignment: 'seed' | 'fallback'): CommunityAssignment {
  return { communityId: communityId(label), communityLabel: label, assignment };
}

/**
 * One pass: the concept folder is the community. Nothing is clustered, nothing
 * is repaired — a leaf lives in one folder, and that folder is its bubble.
 */
export function assignGraphCommunities(
  nodes: WikiGraphNode[],
): WikiGraphNode[] {
  return nodes.map((node) => {
    const folder = conceptFolder(node.id);
    if (folder) return { ...node, community: assigned(title(folder), 'seed') };
    const typeLabel = TYPE_LABELS[node.type];
    if (typeLabel) return { ...node, community: assigned(typeLabel, 'seed') };
    return {
      ...node,
      community: { communityId: UNCLASSIFIED_ID, communityLabel: UNCLASSIFIED_LABEL, assignment: 'fallback' },
    };
  });
}

function isConcept(node: WikiGraphNode): boolean {
  return Boolean(conceptFolder(node.id));
}

function isSource(type: WikiGraphNodeType): boolean {
  return type === 'raw-source' || type === 'wiki-source';
}

export function topologyEtag(nodes: WikiGraphNode[], edges: WikiGraphEdge[]): string {
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

  const record = (
    from: string,
    to: string,
    relation: WikiGraphRelationType | SharedRelationKind,
  ) => {
    if (!from || !to || from === to) return;
    const key = JSON.stringify([from, to]);
    const current = aggregate.get(key) ?? { from, to, count: 0, relations: {} };
    current.count += 1;
    current.relations[relation] = (current.relations[relation] ?? 0) + 1;
    aggregate.set(key, current);
  };

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
    record(from, to, edge.type);
  }

  // Transverse edges between concept folders: a shared subject (entity) or a
  // shared tag (theme) links two leaves across folders.
  const conceptNodes = nodes.filter(isConcept);
  const bySubject = new Map<string, string[]>();
  for (const node of conceptNodes) {
    if (!node.subject) continue;
    const list = bySubject.get(node.subject) ?? [];
    list.push(node.id);
    bySubject.set(node.subject, list);
  }
  for (const ids of bySubject.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const from = communityByNode.get(ids[i]!);
        const to = communityByNode.get(ids[j]!);
        if (from && to && from !== to) record(from, to, 'shared_subject');
      }
    }
  }
  const byTag = new Map<string, string[]>();
  for (const node of conceptNodes) {
    for (const tag of node.tags ?? []) {
      const list = byTag.get(tag) ?? [];
      list.push(node.id);
      byTag.set(tag, list);
    }
  }
  for (const ids of byTag.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const from = communityByNode.get(ids[i]!);
        const to = communityByNode.get(ids[j]!);
        if (from && to && from !== to) record(from, to, 'shared_tag');
      }
    }
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
      ) as WikiGraphCommunityEdge['relations'],
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { communities, communityEdges, topologyEtag: topologyEtag(nodes, edges) };
}

/**
 * Group keys a node belongs to for a given grouping axis.
 *
 * `concept` is the default reading (folder, or the node's type label for the
 * non-concept surfaces). The three other axes read the knowledge surfaces
 * (`wiki/concepts/**` and `wiki/sources/**`): a leaf's `subject`, its OKF
 * `type`, or each of its `tags`. A node without a value for the chosen axis
 * falls back to its type label so it never vanishes from the map.
 */
function axisGroupKeys(node: WikiGraphNode, axis: GroupAxis): string[] {
  if (axis === 'concept') {
    const folder = conceptFolder(node.id);
    return folder ? [folder] : fallbackGroupKeys(node);
  }
  if (node.type !== 'wiki' && node.type !== 'wiki-source') return fallbackGroupKeys(node);
  if (axis === 'subject') return node.subject ? [node.subject] : fallbackGroupKeys(node);
  if (axis === 'type') return node.okfType ? [node.okfType] : fallbackGroupKeys(node);
  const tags = node.tags ?? [];
  return tags.length ? tags : fallbackGroupKeys(node);
}

function fallbackGroupKeys(node: WikiGraphNode): string[] {
  const typeLabel = TYPE_LABELS[node.type];
  return typeLabel ? [typeLabel] : [UNCLASSIFIED_LABEL];
}

function axisSharedKind(axis: GroupAxis): SharedRelationKind {
  if (axis === 'subject') return 'shared_subject';
  if (axis === 'type') return 'shared_type';
  if (axis === 'tag') return 'shared_tag';
  return 'shared_folder';
}

/**
 * A grouping of the corpus by one axis, multi-membership aware.
 *
 * This is the same read as `createCommunityProjection`, re-rooted: the chosen
 * axis becomes the bubble, and the transverse edges come from the OTHER axes —
 * two leaves sharing a `subject` (or a folder, a `type`, a `tag`) in different
 * bubbles are linked across them. A leaf carrying several tags therefore
 * appears in several tag bubbles, and links those bubbles to each other.
 */
export function createAxisGrouping(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  axis: GroupAxis,
): { communities: WikiGraphCommunity[]; communityEdges: WikiGraphCommunityEdge[] } {
  if (axis === 'concept') {
    const projection = createCommunityProjection(nodes, edges);
    return { communities: projection.communities, communityEdges: projection.communityEdges };
  }

  // The subject/type/tag readings only make sense on the knowledge surfaces
  // (concept leaves and source notes): a template or a deliverable carries no
  // subject, no OKF type and no tag, so it has nothing to group by.
  const groupedNodes = nodes.filter(
    (node) => node.type === 'wiki' || node.type === 'wiki-source',
  );
  const nodeById = new Map(groupedNodes.map((node) => [node.id, node]));
  const groupsByNode = new Map<string, string[]>();
  const buckets = new Map<string, string[]>();
  const labelById = new Map<string, string>();

  for (const node of groupedNodes) {
    const keys = axisGroupKeys(node, axis);
    groupsByNode.set(node.id, keys.map(communityId));
    for (const key of keys) {
      const id = communityId(key);
      labelById.set(id, key);
      const list = buckets.get(id) ?? [];
      list.push(node.id);
      buckets.set(id, list);
    }
  }

  const internalCounts = new Map<string, number>();
  const externalCounts = new Map<string, number>();
  const aggregate = new Map<string, WikiGraphCommunityEdge>();

  const record = (
    from: string,
    to: string,
    relation: WikiGraphRelationType | SharedRelationKind,
  ) => {
    if (!from || !to || from === to) return;
    const key = JSON.stringify([from, to]);
    const current = aggregate.get(key) ?? { from, to, count: 0, relations: {} };
    current.count += 1;
    current.relations[relation] = (current.relations[relation] ?? 0) + 1;
    aggregate.set(key, current);
  };

  for (const edge of edges) {
    const fromGroups = groupsByNode.get(edge.from) ?? [];
    const toGroups = groupsByNode.get(edge.to) ?? [];
    for (const from of fromGroups) {
      for (const to of toGroups) {
        if (from === to) {
          internalCounts.set(from, (internalCounts.get(from) ?? 0) + 1);
        } else {
          externalCounts.set(from, (externalCounts.get(from) ?? 0) + 1);
          externalCounts.set(to, (externalCounts.get(to) ?? 0) + 1);
          record(from, to, edge.type);
        }
      }
    }
  }

  // A leaf in several bubbles links those bubbles to each other: the reader
  // must see that two tags co-occur on the same document, not only that two
  // leaves share a tag elsewhere.
  for (const groups of groupsByNode.values()) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        record(groups[i]!, groups[j]!, 'shared_member');
      }
    }
  }

  const sharedKindsBase: Array<{ relation: SharedRelationKind; values: (node: WikiGraphNode) => string[] }> = [
    { relation: 'shared_subject', values: (node) => (node.subject ? [node.subject] : []) },
    { relation: 'shared_type', values: (node) => (node.okfType ? [node.okfType] : []) },
    {
      relation: 'shared_folder',
      values: (node) => {
        const folder = conceptFolder(node.id);
        return folder ? [folder] : [];
      },
    },
    { relation: 'shared_tag', values: (node) => node.tags ?? [] },
  ];
  const sharedKinds = sharedKindsBase.filter((kind) => kind.relation !== axisSharedKind(axis));

  for (const { relation, values } of sharedKinds) {
    const byValue = new Map<string, string[]>();
    for (const node of groupedNodes) {
      for (const value of values(node)) {
        const list = byValue.get(value) ?? [];
        list.push(node.id);
        byValue.set(value, list);
      }
    }
    for (const ids of byValue.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const fromGroups = groupsByNode.get(ids[i]!) ?? [];
          const toGroups = groupsByNode.get(ids[j]!) ?? [];
          for (const from of fromGroups) {
            for (const to of toGroups) record(from, to, relation);
          }
        }
      }
    }
  }

  const communities = [...buckets].map(([id, nodeIds]): WikiGraphCommunity => {
    const sortedMembers = [...nodeIds].sort((a, b) => a.localeCompare(b));
    return {
      id,
      label: labelById.get(id) ?? id,
      nodeIds: sortedMembers,
      documentCount: sortedMembers.length,
      conceptCount: sortedMembers.filter((nodeId) => conceptFolder(nodeId) != null).length,
      sourceCount: sortedMembers.filter((nodeId) => isSource(nodeById.get(nodeId)?.type ?? 'wiki')).length,
      internalRelations: internalCounts.get(id) ?? 0,
      externalRelations: externalCounts.get(id) ?? 0,
    };
  }).sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label));

  const communityEdges = [...aggregate.values()]
    .map((edge) => ({
      ...edge,
      relations: Object.fromEntries(
        Object.entries(edge.relations).sort(([a], [b]) => a.localeCompare(b)),
      ) as WikiGraphCommunityEdge['relations'],
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { communities, communityEdges };
}
