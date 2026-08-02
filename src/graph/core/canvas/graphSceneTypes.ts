export type GraphSceneLevel = 'overview' | 'group' | 'focus' | 'runtime';

export interface GraphSceneNode {
  id: string;
  label: string;
  type: string;
  groupId?: string;
  status?: string;
  degree?: number;
  x?: number;
  y?: number;
  depth?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphSceneEdge {
  id?: string;
  from: string;
  to: string;
  type: string;
  weight?: number;
  active?: boolean;
}

export interface GraphSceneSnapshot {
  revision: string;
  level: GraphSceneLevel;
  nodes: GraphSceneNode[];
  edges: GraphSceneEdge[];
}

export interface GraphScenePatch {
  revision: string;
  upsertNodes?: GraphSceneNode[];
  removeNodeIds?: string[];
  upsertEdges?: GraphSceneEdge[];
  removeEdgeIds?: string[];
}
