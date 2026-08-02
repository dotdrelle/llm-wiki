import type { GraphSceneEdge, GraphSceneNode, GraphSceneSnapshot } from '../../core/canvas/graphSceneTypes.ts';
import type { WikiGraphSnapshot } from '../snapshot.ts';

export type WikiSceneSelection = {
  communityId?: string;
  documentId?: string;
};

function stableUnit(id: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function documentNode(node: WikiGraphSnapshot['nodes'][number], groupId?: string): GraphSceneNode {
  return {
    id: node.id,
    label: node.title,
    type: node.type,
    groupId,
    degree: node.degree,
    depth: 0.9 + stableUnit(node.id, 17) * 0.2,
    metadata: { path: node.id, secondary: node.secondary },
  };
}

function sceneEdges(snapshot: WikiGraphSnapshot, visibleIds: Set<string>): GraphSceneEdge[] {
  return snapshot.edges
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type, weight: 1 }));
}

export function projectWikiScene(
  snapshot: WikiGraphSnapshot,
  selection: WikiSceneSelection = {},
): GraphSceneSnapshot {
  const communityByNode = new Map<string, string>();
  snapshot.communities.forEach((community) => community.nodeIds.forEach((id) => communityByNode.set(id, community.id)));

  if (!selection.communityId) {
    const nodes = snapshot.communities.map((community, index): GraphSceneNode => {
      const angle = (index / Math.max(1, snapshot.communities.length)) * Math.PI * 2 - Math.PI / 2;
      return {
        id: community.id,
        label: community.label,
        type: 'community',
        degree: community.externalRelations,
        x: Math.cos(angle) * 0.34,
        y: Math.sin(angle) * 0.2,
        depth: 0.9 + stableUnit(community.id, 29) * 0.2,
        metadata: { documentCount: community.documentCount, nodeIds: community.nodeIds },
      };
    });
    return {
      revision: snapshot.topologyEtag,
      level: 'overview',
      nodes,
      edges: snapshot.communityEdges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        type: 'community_relation',
        weight: edge.count,
      })),
    };
  }

  const community = snapshot.communities.find((item) => item.id === selection.communityId);
  const memberIds = new Set(community?.nodeIds ?? []);
  const visibleIds = new Set(memberIds);
  if (selection.documentId) {
    snapshot.edges.forEach((edge) => {
      if (edge.from === selection.documentId) visibleIds.add(edge.to);
      if (edge.to === selection.documentId) visibleIds.add(edge.from);
    });
    visibleIds.clear();
    visibleIds.add(selection.documentId);
    snapshot.edges.forEach((edge) => {
      if (edge.from === selection.documentId) visibleIds.add(edge.to);
      if (edge.to === selection.documentId) visibleIds.add(edge.from);
    });
  }

  const nodes = snapshot.nodes
    .filter((node) => visibleIds.has(node.id))
    .sort((left, right) => Number(right.id === selection.documentId) - Number(left.id === selection.documentId) || right.degree - left.degree || left.id.localeCompare(right.id))
    .slice(0, 50)
    .map((node) => documentNode(node, communityByNode.get(node.id)));
  const renderedIds = new Set(nodes.map((node) => node.id));
  return {
    revision: snapshot.topologyEtag,
    level: selection.documentId ? 'focus' : 'group',
    nodes,
    edges: sceneEdges(snapshot, renderedIds),
  };
}
