import { createHash } from 'node:crypto';
import type { WikiGraphEdge, WikiGraphNode } from './projection.ts';

/**
 * Edge identifier derived from content, never from position.
 *
 * `rel-${index}` renumbered every following edge as soon as a page was
 * inserted — that is, on every ingest. No continuity was therefore computable
 * from one revision to the next: the client could not distinguish a relation
 * that persists from a new relation that inherited another one's number.
 *
 * The tuple is unique by construction: `projection.ts` already deduplicates on
 * `from\0to\0type` before producing its edges. We keep a fingerprint rather
 * than the raw tuple because `from` and `to` are full relative paths, and
 * these identifiers travel in **every** snapshot sent to the client.
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
import type { CoverageCounts, PageCoverageState, SynthesisStatus } from './taxonomy/coverage.ts';
import type { SourceCoverage } from './taxonomy/sourceCoverage.ts';

export type SnapshotCoverage = {
  /** Knowledge fingerprint of the current corpus. */
  corpus: string;
  /** Fingerprint the active registry was computed against, if comparable. */
  taxonomizedCorpus: string | null;
  /** True when the two fingerprints are comparable AND equal. */
  fresh: boolean;
  /** Five-state freshness presented to the reader. */
  status: SynthesisStatus;
  counts: CoverageCounts;
  /** Knowledge page → state. Absent for nodes that are not knowledge pages. */
  states: Record<string, PageCoverageState>;
};

const EMPTY_COVERAGE: SnapshotCoverage = {
  corpus: '',
  taxonomizedCorpus: null,
  fresh: false,
  status: 'absent',
  counts: {
    'classified': 0,
    'pending-classification': 0,
    'outside-sample': 0,
    'unclassified': 0,
  },
  states: {},
};

export interface WikiGraphSnapshot {
  workspace: string;
  structureEtag: string;
  topologyEtag: string;
  /**
   * Published taxonomy revision, 0 when no marker exists yet.
   *
   * This is the number the SSE stream announces and that the client compares
   * to ignore a late response. It is exposed even when the taxonomy is purely
   * deterministic: the graph must be able to say "I am up to date" without the
   * synthesis existing.
   */
  taxonomyRevision: number;
  /**
   * Absorbed identifier → active identifier.
   *
   * The client uses it for two losses that would otherwise be visible:
   * following a selection across a merge, and recovering the Canvas position
   * stored under the old identifier. Without this table, a merge reads as a
   * disappearance and the user loses their manual layout.
   */
  communityRedirects: Record<string, string>;
  /**
   * Root domains: the first level of the map.
   *
   * Empty while the taxonomy is deterministic — the map then falls back to its
   * flat rendering, which is correct since no domain exists.
   */
  domains: Array<{ id: string; label: string }>;
  /** Leaf community → domain. This is what makes map → domain possible. */
  communityParents: Record<string, string>;
  /**
   * False while no synthesized registry is active. State the state rather than
   * letting it be guessed: a silent fallback reads as a bug, and a caller that
   * thinks it is reading a synthesized taxonomy draws conclusions it does not
   * support.
   */
  synthesized: boolean;
  /**
   * Taxonomic coverage of the knowledge corpus.
   *
   * Four counters rather than a single `Ungrouped` bucket, because an
   * unassigned page can be so for three reasons that call for different
   * reactions: never submitted to the model, submitted and not classified, or
   * appeared after synthesis. The first screen cannot stay accurate if it
   * conflates them.
   */
  coverage: SnapshotCoverage;
  /**
   * Per-source coverage: `citingPages` (pages citing the source) distinct from
   * `assignedPages` (pages in the source's leaf). A product's coverage reads
   * with `citingPages`; the size of its leaf is `assignedPages`.
   */
  sourceCoverage: SourceCoverage[];
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
    coverage?: SnapshotCoverage;
    sourceCoverage?: SourceCoverage[];
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
    coverage: options.coverage ?? EMPTY_COVERAGE,
    sourceCoverage: options.sourceCoverage ?? [],
    nodes,
    edges,
    communities: communityProjection.communities,
    communityEdges: communityProjection.communityEdges,
    createdAt: Date.now(),
  };
}
