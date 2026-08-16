import type { WikiGraphEdge, WikiGraphNode } from '../projection.ts';
import { resolveCommunity, type TaxonomyRegistry } from './schema.ts';
import { KNOWLEDGE_NODE_TYPES } from './knowledge.ts';

/*
 Coverage of a source, computed independently of the size of its leaf.

 A product's leaf can be huge because many pages share a `group:` or a folder,
 without any of them citing the source itself; conversely a source can be cited
 by pages scattered across several leaves. `citingPages` and `assignedPages`
 therefore measure two different things and must never be folded into one
 number: the difference is the information — transverse pages, secondary
 relations — not an error to hide.

 `citingPages` — pages that reference the source's canonical note (a `cites`
 citation, a link, or a `generated_from` relation). It is the coverage of the
 source in the corpus.

 `assignedPages` — pages whose resolved leaf is the same leaf as the source's.
 It is the size of the leaf, i.e. what the source's product owns.
*/

/** Relation types that count as "a page cites the source". */
const CITING_RELATIONS = new Set(['cites', 'links_to', 'related_to', 'generated_from']);

export type SourceCoverage = {
  /** Workspace-relative path of the source node. */
  id: string;
  /** Canonical subject carried by the source (provenance), when present. */
  subject: string | null;
  /** Resolved leaf of the source, when the registry assigns one. */
  leafId: string | null;
  /** Knowledge pages that cite this source. */
  citingPages: number;
  /** Knowledge pages whose resolved leaf is the source's leaf. */
  assignedPages: number;
};

/**
 * Per-source coverage, computed on the graph and the active registry.
 *
 * Pure and deterministic: it reads only the projection (nodes/edges) and the
 * registry, never disk, never a model. `registry: null` means the taxonomy is
 * deterministic — every `assignedPages` is then `0` and `leafId` is null, while
 * `citingPages` remains computable from the citations alone.
 */
export function computeSourceCoverage(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  registry: TaxonomyRegistry | null,
): SourceCoverage[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const knowledge = new Set(
    nodes.filter((node) => KNOWLEDGE_NODE_TYPES.has(node.type)).map((node) => node.id),
  );

  // Resolved leaf per page: follow absorptions, keep the active community.
  const leafOf = new Map<string, string | null>();
  if (registry) {
    for (const [page, assignment] of Object.entries(registry.assignments)) {
      const resolved = resolveCommunity(registry, assignment.primaryCommunity);
      leafOf.set(page, resolved && !resolved.deprecated ? resolved.id : null);
    }
  }

  const citing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!CITING_RELATIONS.has(edge.type)) continue;
    const source = byId.get(edge.to);
    if (!source || (source.type !== 'raw-source' && source.type !== 'wiki-source')) continue;
    const from = byId.get(edge.from);
    if (!from || !knowledge.has(edge.from)) continue;
    if (!citing.has(source.id)) citing.set(source.id, new Set());
    citing.get(source.id)!.add(edge.from);
  }

  // A page's own leaf counts as the leaf membership of every source that lands
  // in the same leaf: count once, keyed by leaf id, then attribute to sources.
  const leafSize = new Map<string, number>();
  for (const page of knowledge) {
    const leaf = leafOf.get(page) ?? null;
    if (!leaf) continue;
    leafSize.set(leaf, (leafSize.get(leaf) ?? 0) + 1);
  }

  const sources = nodes
    .filter((node) => node.type === 'raw-source' || node.type === 'wiki-source')
    .sort((a, b) => a.id.localeCompare(b.id));

  return sources.map((source) => {
    const leafId = leafOf.get(source.id) ?? null;
    const citingPages = citing.get(source.id)?.size ?? 0;
    const assignedPages = leafId ? (leafSize.get(leafId) ?? 0) : 0;
    return {
      id: source.id,
      subject: source.subject ?? null,
      leafId,
      citingPages,
      assignedPages,
    };
  });
}
