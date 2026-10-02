import type { AppConfig } from '../types.ts';
import { RetrievalService } from '../services/retrievalService.ts';
import type { WorkspaceService } from '../services/workspaceService.ts';
import { loadTaxoGraph } from '../graph/wiki/taxoGraph.ts';
import type { GraphSearchAnswer } from './routes/graphRoutes.ts';

/**
 * The graph search goes through the engine's own retrieval — BM25, plus
 * vectors when `retrieval.vector` is configured — not a second matcher. Its
 * page cache is dropped whenever the TAXO graph etag moves, so a fresh ingest
 * is searchable without restarting serve. The answer names the mode actually
 * used (`hybrid`, `lexical`, `lexical-fallback`) so the page can say when the
 * vector index was not there.
 */
/*
 Retrieval always fills its window: on a small corpus the top 40 is nearly
 every fiche, and a graph that lights everything has answered nothing. Keep
 what scores within half of the best match (scores are only comparable inside
 one answer, so the cut is relative), best first.
 */
const RELATIVE_CUTOFF = 0.5;
const MAX_HITS = 25;
function relevant(best: Map<string, number>): GraphSearchAnswer['results'] {
  const ranked = [...best].map(([path, score]) => ({ path, score })).sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  return ranked.filter((item) => top <= 0 || item.score >= top * RELATIVE_CUTOFF).slice(0, MAX_HITS);
}

/** Below this reranker score a hit is noise (scores are 0..1 relevance). */
const RERANK_FLOOR = 0.05;
const WEAK_HITS = 5;
function bestPerPage(results: Array<{ page: { relativePath: string }; score: number }>): Map<string, number> {
  const best = new Map<string, number>();
  for (const result of results) {
    const page = result.page.relativePath;
    best.set(page, Math.max(best.get(page) ?? 0, result.score));
  }
  return best;
}

const searches = new Map<string, (query: string) => Promise<GraphSearchAnswer>>();

/** One search per workspace root: serve calls this on every request. */
export function createGraphSearch(workspace: WorkspaceService, config: AppConfig, rootDir: string) {
  const existing = searches.get(rootDir);
  if (existing) return existing;
  const retrieval = new RetrievalService(workspace, config);
  let etag = '';
  const search = async (query: string): Promise<GraphSearchAnswer> => {
    const current = (await loadTaxoGraph(rootDir)).etag;
    if (current !== etag) { retrieval.invalidateCache(); etag = current; }
    // The hybrid answer is rank-fused (flat scores); the configured reranker
    // gives scores a cut can read. Rerank off or failing: the fused order stays.
    const fused = await retrieval.search(query, { limit: 40, intent: 'search' });
    const diagnostics = retrieval.getLastSearchDiagnostics();
    const results = diagnostics.mode === 'hybrid' ? await retrieval.rerankResults(query, fused) : fused;
    const best = bestPerPage(results);
    // The reranker judged nothing relevant (all scores near zero): a relative
    // cut would then keep everything. Show the few best fused hits instead,
    // flagged weak, rather than lighting the whole graph or showing nothing.
    const reranked = results !== fused;
    if (reranked && Math.max(0, ...best.values()) < RERANK_FLOOR) {
      const top = [...bestPerPage(fused)].sort((a, b) => b[1] - a[1]).slice(0, WEAK_HITS);
      return { mode: diagnostics.mode, reason: diagnostics.reason, weak: true, results: top.map(([path, score]) => ({ path, score })) };
    }
    return {
      mode: diagnostics.mode,
      reason: diagnostics.reason,
      results: relevant(best),
    };
  };
  searches.set(rootDir, search);
  return search;
}
