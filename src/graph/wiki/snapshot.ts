import { createHash } from 'node:crypto';
import type { WikiGraphEdge, WikiGraphNode } from './projection.ts';

/**
 * Identifiant d'arête dérivé du contenu, jamais de la position.
 *
 * `rel-${index}` renumérotait toutes les arêtes suivantes dès qu'une page était
 * insérée — c'est-à-dire à chaque ingestion. Aucune continuité n'était donc
 * calculable d'une révision à l'autre : le client ne pouvait pas distinguer une
 * relation qui persiste d'une relation nouvelle qui a hérité du numéro d'une
 * autre.
 *
 * Le triplet est unique par construction : `projection.ts` déduplique déjà sur
 * `from\0to\0type` avant de produire ses arêtes. On garde une empreinte plutôt
 * que le triplet brut parce que `from` et `to` sont des chemins relatifs
 * complets, et que ces identifiants voyagent dans **chaque** snapshot renvoyé
 * au client.
 */
export function graphEdgeId(edge: Pick<WikiGraphEdge, 'from' | 'to' | 'type'>): string {
  return createHash('sha256')
    .update(JSON.stringify([edge.from, edge.to, edge.type]), 'utf8')
    .digest('hex')
    .slice(0, 16);
}
import {
  createCommunityProjection,
  type WikiGraphCommunity,
  type WikiGraphCommunityEdge,
} from './communityProjection.ts';

export type { WikiGraphCommunity } from './communityProjection.ts';

export interface WikiGraphSnapshot {
  workspace: string;
  structureEtag: string;
  topologyEtag: string;
  /**
   * Révision de taxonomie publiée, 0 quand aucun marqueur n'existe encore.
   *
   * C'est le numéro que le flux SSE annonce et que le client compare pour
   * ignorer une réponse tardive. Il est exposé même quand la taxonomie est
   * purement déterministe : le graphe doit pouvoir dire « je suis à jour »
   * sans que la synthèse existe.
   */
  taxonomyRevision: number;
  /**
   * Identifiant absorbé → identifiant actif.
   *
   * Le client s'en sert pour deux pertes qui seraient sinon visibles : suivre
   * une sélection à travers une fusion, et retrouver la position Canvas
   * enregistrée sous l'ancien identifiant. Sans cette table, une fusion se lit
   * comme une disparition et l'utilisateur perd sa disposition manuelle.
   */
  communityRedirects: Record<string, string>;
  /**
   * Domaines racines : le premier niveau de la carte.
   *
   * Vide tant que la taxonomie est déterministe — la carte retombe alors sur
   * son rendu plat, ce qui est correct puisqu'aucun domaine n'existe.
   */
  domains: Array<{ id: string; label: string }>;
  /** Communauté feuille → domaine. C'est ce qui rend `carte → domaine` possible. */
  communityParents: Record<string, string>;
  /**
   * Faux tant qu'aucun registre synthétisé n'est actif. Dire l'état plutôt que
   * de le laisser deviner : un repli silencieux se lit comme un bug, et un
   * appelant qui croit lire une taxonomie synthétisée en tire des conclusions
   * qu'elle ne porte pas.
   */
  synthesized: boolean;
  nodes: Array<Omit<WikiGraphNode, 'raw' | 'html' | 'preview'>>;
  edges: Array<WikiGraphEdge & { id: string }>;
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  createdAt: number;
}

type CacheEntry = { etag: string; snapshot: WikiGraphSnapshot };
const cache = new Map<string, CacheEntry>();

export function cachedSnapshot(rootDir: string, etag: string): WikiGraphSnapshot | undefined {
  const entry = cache.get(rootDir);
  return entry?.etag === etag ? entry.snapshot : undefined;
}

export function storeSnapshot(
  rootDir: string,
  snapshot: WikiGraphSnapshot,
  cacheEtag = snapshot.structureEtag,
): WikiGraphSnapshot {
  cache.set(rootDir, { etag: cacheEtag, snapshot });
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return snapshot;
}

export function createSnapshot(
  etag: string,
  graph: { nodes: WikiGraphNode[]; edges: WikiGraphEdge[] },
  options: {
    workspace?: string;
    taxonomyRevision?: number;
    synthesized?: boolean;
    communityRedirects?: Record<string, string>;
    domains?: Array<{ id: string; label: string }>;
    communityParents?: Record<string, string>;
  } = {},
): WikiGraphSnapshot {
  const nodes = graph.nodes.map(({ raw, html, preview, ...node }) => {
    void raw; void html; void preview;
    return node;
  });
  const edges = graph.edges.map((edge) => ({ ...edge, id: graphEdgeId(edge) }));
  const communityProjection = createCommunityProjection(graph.nodes, graph.edges);
  return {
    workspace: options.workspace ?? 'wiki',
    structureEtag: etag,
    topologyEtag: communityProjection.topologyEtag,
    taxonomyRevision: options.taxonomyRevision ?? 0,
    synthesized: options.synthesized ?? false,
    communityRedirects: options.communityRedirects ?? {},
    domains: options.domains ?? [],
    communityParents: options.communityParents ?? {},
    nodes,
    edges,
    communities: communityProjection.communities,
    communityEdges: communityProjection.communityEdges,
    createdAt: Date.now(),
  };
}
