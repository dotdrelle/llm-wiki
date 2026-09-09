import matter from 'gray-matter';
import { extractSourceCitations, extractWikiLinks } from '../../utils/markdown.ts';
import type { WorkspaceService } from '../../services/workspaceService.ts';

// The structural minimum the builder reads from a workspace page.
type GraphPage = { relativePath: string; name: string; type: string; content: string };

/**
 * The queryable graph — the refonte report's queue item.
 *
 * The visual graph is a drawing scene (x, y, r, html) and its transverse edges
 * (shared `subject`, shared `tags`) were computed for the community bubbles
 * only, never materialized — so no agent could ask "which pages share this
 * subject" or "what sits between this source and that concept". This module
 * materializes the full edge set over the knowledge corpus (wiki pages + the
 * raw sources that produced them) and answers those questions.
 *
 * Deterministic and fresh by construction: every call re-reads the files, so
 * there is no cache to invalidate and no snapshot to drift — the wiki is the
 * source of truth, this is just its adjacency.
 */

export type QueryEdgeType =
  | 'citation'
  | 'produces'
  | 'wiki_link'
  | 'shared_subject'
  | 'shared_tag';

export interface QueryGraphNode {
  id: string;
  label: string;
  type: string;
  subject?: string;
  concept?: string;
  tags: string[];
}

export interface QueryGraphEdge {
  from: string;
  to: string;
  type: QueryEdgeType;
}

export interface QueryGraph {
  nodes: QueryGraphNode[];
  nodeById: Map<string, QueryGraphNode>;
  adjacency: Map<string, Array<{ to: string; type: QueryEdgeType }>>;
  byTag: Map<string, string[]>;
  byConcept: Map<string, string[]>;
}

function frontmatterOf(page: GraphPage): { subject?: string; tags: string[]; title?: string } {
  try {
    const parsed = matter(page.content);
    const data = parsed.data as Record<string, unknown>;
    const tags = Array.isArray(data.tags) ? data.tags.filter((value) => typeof value === 'string') : [];
    return {
      subject: typeof data.subject === 'string' && data.subject.trim() ? data.subject.trim() : undefined,
      tags,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined,
    };
  } catch {
    return { tags: [] };
  }
}

function conceptFolderOf(id: string): string | undefined {
  const parts = id.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4
    ? parts[2]
    : undefined;
}

function normalizeLinkTarget(target: string): string {
  const cleaned = target.replace(/^\.\//, '').replace(/\.md$/, '');
  if (cleaned.startsWith('wiki/')) return cleaned;
  return `wiki/${cleaned}`;
}

function addEdge(
  adjacency: Map<string, Array<{ to: string; type: QueryEdgeType }>>,
  from: string,
  to: string,
  type: QueryEdgeType,
): void {
  if (from === to) return;
  const outgoing = adjacency.get(from) ?? [];
  if (!outgoing.some((entry) => entry.to === to && entry.type === type)) {
    outgoing.push({ to, type });
    adjacency.set(from, outgoing);
  }
}

/**
 * Builds the adjacency over the knowledge corpus: wiki pages and the ingested
 * raw sources. Edges: citations ([src: ...]), wiki links ([[...]]), shared
 * `subject` between concept leaves, and shared `tags` entries.
 */
export async function buildQueryGraph(workspace: WorkspaceService): Promise<QueryGraph> {
  const [wikiPages, rawSources] = await Promise.all([
    workspace.listWikiPages(),
    workspace.listIngestedSourcePages(),
  ]);

  const nodes: QueryGraphNode[] = [];
  const nodeById = new Map<string, QueryGraphNode>();
  const adjacency = new Map<string, Array<{ to: string; type: QueryEdgeType }>>();
  const byTag = new Map<string, string[]>();
  const byConcept = new Map<string, string[]>();
  const bySubject = new Map<string, string[]>();

  for (const page of wikiPages) {
    if (page.type === 'answer') continue;
    const meta = frontmatterOf(page);
    const node: QueryGraphNode = {
      id: page.relativePath.replace(/\.md$/, ''),
      label: meta.title ?? page.name,
      type: page.type,
      ...(meta.subject ? { subject: meta.subject } : {}),
      tags: meta.tags,
    };
    const concept = conceptFolderOf(page.relativePath);
    if (concept) node.concept = concept;
    nodes.push(node);
    nodeById.set(node.id, node);
    if (node.concept) byConcept.set(node.concept, [...(byConcept.get(node.concept) ?? []), node.id]);
    if (node.subject) bySubject.set(node.subject, [...(bySubject.get(node.subject) ?? []), node.id]);
    for (const tag of node.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), node.id]);
  }

  for (const source of rawSources) {
    const meta = frontmatterOf(source);
    const node: QueryGraphNode = {
      id: source.relativePath.replace(/\.md$/, ''),
      label: meta.title ?? source.name,
      type: 'raw-source',
      tags: meta.tags,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
  }

  for (const page of wikiPages) {
    if (page.type === 'answer') continue;
    const from = page.relativePath.replace(/\.md$/, '');
    for (const citation of extractSourceCitations(page.content)) {
      const target = citation.replace(/^\.\//, '').replace(/\.md$/, '');
      // Provenance is one relationship, two directions: the page CITES its
      // source, the source PRODUCES the page. Both are materialized so a
      // query can start from either end.
      addEdge(adjacency, from, target, 'citation');
      addEdge(adjacency, target, from, 'produces');
    }
    for (const link of extractWikiLinks(page.content)) {
      const target = normalizeLinkTarget(link);
      if (nodeById.has(target)) addEdge(adjacency, from, target, 'wiki_link');
    }
  }

  // The transverse edges, now materialized: an entity cited under several
  // concepts, or a theme shared through tags.
  for (const ids of bySubject.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addEdge(adjacency, ids[i], ids[j], 'shared_subject');
        addEdge(adjacency, ids[j], ids[i], 'shared_subject');
      }
    }
  }
  for (const ids of byTag.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addEdge(adjacency, ids[i], ids[j], 'shared_tag');
        addEdge(adjacency, ids[j], ids[i], 'shared_tag');
      }
    }
  }

  return { nodes, nodeById, adjacency, byTag, byConcept };
}

export interface GraphPathEntry {
  node: QueryGraphNode;
  edgeType: QueryEdgeType | null;
}

export function graphShortestPath(
  graph: QueryGraph,
  from: string,
  to: string,
  options: { edgeTypes?: QueryEdgeType[] } = {},
): GraphPathEntry[] | null {
  const allowed = options.edgeTypes ? new Set(options.edgeTypes) : null;
  if (!graph.nodeById.has(from) || !graph.nodeById.has(to)) return null;
  if (from === to) return [{ node: graph.nodeById.get(from)!, edgeType: null }];
  const previous = new Map<string, { from: string; type: QueryEdgeType }>();
  const queue: string[] = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { to: next, type } of graph.adjacency.get(current) ?? []) {
      if (allowed && !allowed.has(type)) continue;
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { from: current, type });
      if (next === to) {
        const path: GraphPathEntry[] = [];
        let cursor: string | undefined = to;
        while (cursor) {
          const node = graph.nodeById.get(cursor);
          if (!node) break;
          path.unshift({ node, edgeType: cursor === from ? null : previous.get(cursor)?.type ?? null });
          cursor = previous.get(cursor)?.from;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export interface GraphNeighbor {
  node: QueryGraphNode;
  edgeType: QueryEdgeType;
  depth: number;
}

export function graphNeighbors(
  graph: QueryGraph,
  nodeId: string,
  options: { edgeTypes?: QueryEdgeType[]; maxDepth?: number; limit?: number } = {},
): GraphNeighbor[] {
  const allowed = options.edgeTypes ? new Set(options.edgeTypes) : null;
  const maxDepth = Math.max(1, options.maxDepth ?? 1);
  const limit = options.limit ?? 50;
  const results: GraphNeighbor[] = [];
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let depth = 1; depth <= maxDepth && results.length < limit; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const { to, type } of graph.adjacency.get(current) ?? []) {
        if (allowed && !allowed.has(type)) continue;
        if (seen.has(to)) continue;
        seen.add(to);
        const node = graph.nodeById.get(to);
        if (!node) continue;
        results.push({ node, edgeType: type, depth });
        if (results.length >= limit) return results;
        next.push(to);
      }
    }
    frontier = next;
  }
  return results;
}

export function graphNodesByTag(graph: QueryGraph, tag: string): QueryGraphNode[] {
  return (graph.byTag.get(tag) ?? []).map((id) => graph.nodeById.get(id)!).filter(Boolean);
}

export function graphNodesByConcept(graph: QueryGraph, concept: string): QueryGraphNode[] {
  return (graph.byConcept.get(concept) ?? []).map((id) => graph.nodeById.get(id)!).filter(Boolean);
}
