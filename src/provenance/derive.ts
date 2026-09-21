import { extractSourceCitationsWithAnchors } from '../utils/markdown.ts';

/*
 * Lot 3 of `plan-provenance-feuilles.md`: the frontmatter `sources:` field is
 * DERIVED from the body's citation closure, never accumulated. A citation to a
 * `wiki/concepts|sources` page is followed to its own citations; the closure
 * ends on `raw/ingested` archives, which are the terminal proofs.
 *
 * This is the deterministic core the ingest writer, `wiki_write_page` and the
 * curation merge share. It reads text only — no workspace, no LLM.
 */

export interface BodyCitation {
  path: string;
  anchor: string | null;
}

export function extractBodyCitations(content: string): BodyCitation[] {
  const out: BodyCitation[] = [];
  const seen = new Set<string>();
  for (const citation of extractSourceCitationsWithAnchors(content)) {
    const path = citation.path.replace(/\\/g, '/');
    const key = `${path}#${citation.anchor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, anchor: citation.anchor });
  }
  return out;
}

export function isRawIngestedPath(value: string): boolean {
  return /^raw\/ingested\//.test(value);
}

export function isWikiPagePath(value: string): boolean {
  return /^wiki\/(concepts|sources)\//.test(value);
}

export interface DeriveTerminalSourcesOptions {
  /** Page content whose citations are the starting point. */
  content: string;
  /** Body of a cited `wiki/` page, or `null` when it cannot be read. */
  resolvePage?: (pagePath: string) => string | null;
  /** Maximum citation hops (default 3, as the plan fixes). */
  maxDepth?: number;
}

export interface DeriveTerminalSourcesResult {
  /** Sorted unique terminal `raw/…` paths reached from the body. */
  terminal: string[];
  /** Cited targets that could not be followed to a terminal proof. */
  unresolved: string[];
  /** Citation cycles, each listed once. */
  cycles: string[][];
  /** True when the depth ceiling cut a branch. */
  depthExceeded: boolean;
}

export function deriveTerminalSources(options: DeriveTerminalSourcesOptions): DeriveTerminalSourcesResult {
  const maxDepth = options.maxDepth ?? 3;
  const terminal = new Set<string>();
  const unresolved = new Set<string>();
  const cycles: string[][] = [];
  let depthExceeded = false;
  const stack: string[] = [];
  const visited = new Set<string>();

  const walk = (content: string, depth: number): void => {
    for (const citation of extractBodyCitations(content)) {
      if (isRawIngestedPath(citation.path)) {
        terminal.add(citation.path);
        continue;
      }
      if (!isWikiPagePath(citation.path)) {
        // A non-wiki, non-archive target (raw/untracked, relative, external).
        if (citation.path.startsWith('raw/')) terminal.add(citation.path);
        else unresolved.add(citation.path);
        continue;
      }
      if (stack.includes(citation.path)) {
        const cycle = stack.slice(stack.indexOf(citation.path));
        // Canonical: smallest node first, so the same cycle is listed once.
        const minIndex = cycle.reduce((best, value, index) => (value < cycle[best] ? index : best), 0);
        cycles.push([...cycle.slice(minIndex), ...cycle.slice(0, minIndex)]);
        continue;
      }
      if (visited.has(citation.path)) continue;
      if (depth >= maxDepth) {
        depthExceeded = true;
        unresolved.add(citation.path);
        continue;
      }
      const body = options.resolvePage?.(citation.path) ?? null;
      if (body === null) {
        unresolved.add(citation.path);
        continue;
      }
      visited.add(citation.path);
      stack.push(citation.path);
      walk(body, depth + 1);
      stack.pop();
    }
  };

  walk(options.content, 0);
  return {
    terminal: [...terminal].sort(),
    unresolved: [...unresolved].sort(),
    cycles,
    depthExceeded,
  };
}

export interface SourcesIntegrity {
  /** Declared in `sources:` but never reached from the body. */
  missing: string[];
  /** Reached from the body but absent from `sources:`. */
  undeclared: string[];
}

/** The invariant the ingest, the MCP write and the curation merge all share. */
export function validateSourcesIntegrity(declared: string[], terminal: string[]): SourcesIntegrity {
  const declaredSet = new Set(declared.map((entry) => entry.replace(/\\/g, '/')));
  const terminalSet = new Set(terminal.map((entry) => entry.replace(/\\/g, '/')));
  return {
    missing: [...declaredSet].filter((entry) => !terminalSet.has(entry)).sort(),
    undeclared: [...terminalSet].filter((entry) => !declaredSet.has(entry)).sort(),
  };
}
