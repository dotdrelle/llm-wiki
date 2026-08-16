import path from 'node:path';
import { buildGraphOverview, graphEtagForFiles, listGraphFiles } from '../../serve/html/wikiHtml.ts';
import { cachedSnapshot, createSnapshot, storeSnapshot, type WikiGraphSnapshot } from './snapshot.ts';
import { computeCoverage } from './taxonomy/coverage.ts';
import { knowledgeEtag } from './taxonomy/knowledge.ts';
import { computeSourceCoverage } from './taxonomy/sourceCoverage.ts';
import { readActiveRegistry, readDirtyFlag, readMarker } from './taxonomy/store.ts';
import { communityHierarchy, communityRedirects, registryLookup } from './taxonomy/lookup.ts';
import { validateRegistry } from './taxonomy/schema.ts';

/**
 * Projection version, to increment as soon as the way communities or
 * assignments are derived changes.
 *
 * It enters the cache key for the same reason as the taxonomy revision:
 * without it, a deployment that changes the projection would keep serving
 * snapshots computed by the old one, until a Markdown file moves.
 */
export const GRAPH_PROJECTION_VERSION = 1;

/**
 * Single entry point for "give me the current wiki graph snapshot".
 *
 * The etag/cache sequence used to live inline in `serve/routes/graphRoutes.ts`.
 * It has a second caller now (the `wiki_outline` MCP tool), and duplicating it
 * would be worse than it looks: `snapshot.ts` keys its cache by `rootDir`
 * alone, so two callers computing two different cache etags for the same
 * workspace would evict each other on every call. One function, one cache key.
 */
export async function loadWikiGraphSnapshot(options: {
  rootDir: string;
  workspace?: string;
  fallbackCommunityLabel?: string;
  /** Display language of the registry labels (`config.language`). */
  language?: string;
}): Promise<WikiGraphSnapshot> {
  const { rootDir } = options;
  const fallbackCommunityLabel = options.fallbackCommunityLabel ?? 'Ungrouped';
  const workspace = options.workspace ?? path.basename(rootDir);
  const language = options.language ?? 'en';

  const files = await listGraphFiles(rootDir);
  const etag = await graphEtagForFiles(rootDir, files);
  /*
   The taxonomy revision enters the cache key.

   Without it, a rewrite of the registry ALONE — that is, any consolidation
   that renames or merges without the corpus moving — would stay invisible
   until the next modification of a Markdown file. The `structureEtag` only
   describes the files; it cannot know anything about a taxonomy published
   alongside them.
  */
  const marker = await readMarker(rootDir);
  const taxonomyRevision = marker?.revision ?? 0;
  const synthesized = Boolean(marker?.registryRef);
  const cacheEtag = JSON.stringify([
    etag,
    workspace,
    fallbackCommunityLabel,
    taxonomyRevision,
    // The language changes the rendered labels without changing either the
    // files or the revision: without it in the key, a switch would stay
    // invisible.
    language,
    GRAPH_PROJECTION_VERSION,
  ]);

  const cached = cachedSnapshot(rootDir, cacheEtag);
  if (cached) return cached;

  /*
   Reading the registry — never an LLM call.

   `loadWikiGraphSnapshot` has two callers, including the `wiki_outline` MCP
   tool that Donna calls herself. Making this path depend on a model would give
   an HTTP request waiting for an inference, and a cycle
   `wiki_outline → snapshot → LLM → Donna`. The registry is an already-written
   artifact: we read it, we do not compute it.

   A missing, stale, other-version or invalid registry falls back to the
   deterministic projection. `synthesized` says which of the two served, so
   that a fallback does not read as a bug.
  */
  const active = synthesized ? await readActiveRegistry(rootDir) : null;
  const validation = active?.registry ? validateRegistry(active.registry) : null;
  const registry = validation?.ok ? registryLookup(validation.registry, language) : undefined;
  const hierarchy = validation?.ok ? communityHierarchy(validation.registry, language) : null;

  const graph = await buildGraphOverview(rootDir, files, fallbackCommunityLabel, { registry });

  /*
   Coverage: four states, computed once, never re-derived on screen.

   The knowledge fingerprint is the only thing that decides freshness; the
   `structureEtag` above keeps driving the display cache, where it is right to
   react to templates and deliverables. Conflating them was the original
   defect: a `build` was enough to announce a stale taxonomy.
  */
  const knowledgePages = graph.nodes
    .filter((node) => KNOWLEDGE_NODE_TYPES.has(node.type))
    .map((node) => node.id)
    .sort();
  const report = computeCoverage({
    corpus: await knowledgeEtag(rootDir),
    corpusPageIds: knowledgePages,
    marker,
    registry: validation?.ok ? validation.registry : null,
    dirtyFlag: await readDirtyFlag(rootDir),
  });

  return storeSnapshot(
    rootDir,
    createSnapshot(etag, graph, {
      workspace,
      taxonomyRevision,
      synthesized: Boolean(registry),
      coverage: {
        corpus: report.corpus,
        taxonomizedCorpus: report.taxonomizedCorpus,
        fresh: report.fresh,
        status: report.status,
        counts: report.counts,
        states: Object.fromEntries(report.states),
      },
      sourceCoverage: computeSourceCoverage(graph.nodes, graph.edges, validation?.ok ? validation.registry : null),
      communityRedirects: validation?.ok ? communityRedirects(validation.registry) : {},
      /*
       Explicit mapping, never a spread.

       `communityHierarchy` returns `{ domains, parents }`; the snapshot expects
       `communityParents`. Spread, the object passed `parents` — a key nobody
       reads — and `communityParents` stayed empty: all the leaves appeared
       parentless, so the map AND the index stayed flat while the registry was
       indeed hierarchical. TypeScript does not check the excess properties of
       a spread, hence a bug invisible to typing as well as to tests that only
       inspected text.
      */
      ...(hierarchy ? { domains: hierarchy.domains, communityParents: hierarchy.parents } : {}),
    }),
    cacheEtag,
  );
}

// Source of truth shared with the knowledge fingerprint and the inventory: a
// file must not be able to be classified without taking part in the
// fingerprint.
export { KNOWLEDGE_NODE_TYPES } from './taxonomy/knowledge.ts';
import { KNOWLEDGE_NODE_TYPES } from './taxonomy/knowledge.ts';

export interface WikiOutlineCommunity {
  id: string;
  label: string;
  documentCount: number;
  conceptCount: number;
  sourceCount: number;
  internalRelations: number;
  externalRelations: number;
  topPages: string[];
}

export interface WikiOutline {
  workspace: string;
  topologyEtag: string;
  pageCount: number;
  communityCount: number;
  /** True when every community fell back to the default label. */
  degenerate: boolean;
  communities: WikiOutlineCommunity[];
  communityEdges: Array<{ from: string; to: string; count: number }>;
  truncated: boolean;
}

/**
 * Communities, sizes and their most connected pages — never page content.
 *
 * The outline exists to decide *what to read*; reading is `wiki_collect_context`'s
 * job. Returning content here would blow up the context window of the very
 * turn that is supposed to be planning cheaply.
 */
export function summarizeWikiGraph(
  snapshot: WikiGraphSnapshot,
  options: { fallbackCommunityLabel?: string; maxCommunities?: number; maxPagesPerCommunity?: number } = {},
): WikiOutline {
  const fallbackCommunityLabel = options.fallbackCommunityLabel ?? 'Ungrouped';
  const maxCommunities = options.maxCommunities ?? 40;
  const maxPagesPerCommunity = options.maxPagesPerCommunity ?? 8;

  const degree = new Map<string, number>();
  for (const edge of snapshot.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const ranked = [...snapshot.communities].sort(
    (a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label),
  );
  const kept = ranked.slice(0, maxCommunities);

  const communities = kept.map((community) => ({
    id: community.id,
    label: community.label,
    documentCount: community.documentCount,
    conceptCount: community.conceptCount,
    sourceCount: community.sourceCount,
    internalRelations: community.internalRelations,
    externalRelations: community.externalRelations,
    // Node ids are workspace-relative paths. The graph also carries template,
    // build-context and deliverable nodes; anchoring a slot on a deliverable
    // would be circular, so only knowledge pages are offered here.
    topPages: [...community.nodeIds]
      .filter((nodeId) => KNOWLEDGE_NODE_TYPES.has(nodeById.get(nodeId)?.type ?? ''))
      .sort(
        (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
      )
      .slice(0, maxPagesPerCommunity),
  }));

  const keptIds = new Set(communities.map((community) => community.id));

  return {
    workspace: snapshot.workspace,
    topologyEtag: snapshot.topologyEtag,
    pageCount: snapshot.nodes.length,
    communityCount: snapshot.communities.length,
    // A freshly ingested wiki has no explicit communities at all. Saying so
    // is the point: a caller that mistakes one fallback bucket for a topology
    // will happily invent template sections the wiki cannot support.
    degenerate:
      snapshot.communities.length === 0 ||
      snapshot.communities.every((community) => community.label === fallbackCommunityLabel),
    communities,
    communityEdges: snapshot.communityEdges
      .filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to))
      .map((edge) => ({ from: edge.from, to: edge.to, count: edge.count })),
    truncated: ranked.length > kept.length,
  };
}
