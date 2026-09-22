import { extractSourceCitationsWithAnchors } from '../utils/markdown.ts';
import { resolveAnchor } from './locators.ts';

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

export interface TerminalFragment {
  path: string;
  /** The terminal section anchor, when the citation named one. */
  anchor: string | null;
}

export interface DeriveTerminalSourcesResult {
  /** Sorted unique terminal `raw/…` paths reached from the body. */
  terminal: string[];
  /**
   * The terminal proofs with the anchor that reached them, so a caller can
   * detect the loss of a precise SECTION and not only of a whole file.
   */
  fragments: TerminalFragment[];
  /** Cited targets that could not be followed to a terminal proof. */
  unresolved: string[];
  /** Citation cycles, each listed once. */
  cycles: string[][];
  /** True when the depth ceiling cut a branch. */
  depthExceeded: boolean;
}

export function deriveTerminalSources(options: DeriveTerminalSourcesOptions): DeriveTerminalSourcesResult {
  const maxDepth = options.maxDepth ?? 3;
  const fragments = new Map<string, TerminalFragment>();
  const unresolved = new Set<string>();
  const cycles: string[][] = [];
  let depthExceeded = false;
  const stack: string[] = [];
  const visited = new Set<string>();

  const recordTerminal = (path: string, anchor: string | null): void => {
    const key = `${path}#${anchor ?? ''}`;
    if (!fragments.has(key)) fragments.set(key, { path, anchor });
  };

  const walk = (content: string, depth: number): void => {
    for (const citation of extractBodyCitations(content)) {
      if (isRawIngestedPath(citation.path)) {
        recordTerminal(citation.path, citation.anchor);
        continue;
      }
      if (!isWikiPagePath(citation.path)) {
        // A non-wiki, non-archive target (raw/untracked, relative, external).
        if (citation.path.startsWith('raw/')) recordTerminal(citation.path, citation.anchor);
        else unresolved.add(citation.path);
        continue;
      }
      // A citation that names a section follows ONLY that section: walking the
      // whole page would attribute every other section's proofs to the caller
      // and make `detectSourceLoss` blind to a section-level change.
      const nodeKey = `${citation.path}#${citation.anchor ?? ''}`;
      if (stack.includes(nodeKey)) {
        const cycle = stack
          .slice(stack.indexOf(nodeKey))
          .map((key) => key.slice(0, key.lastIndexOf('#')));
        // Canonical: smallest node first, so the same cycle is listed once.
        const minIndex = cycle.reduce((best, value, index) => (value < cycle[best] ? index : best), 0);
        cycles.push([...cycle.slice(minIndex), ...cycle.slice(0, minIndex)]);
        continue;
      }
      if (visited.has(nodeKey)) continue;
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
      let scope = body;
      if (citation.anchor) {
        const resolution = resolveAnchor(body, citation.anchor);
        if (resolution.status !== 'resolved') {
          unresolved.add(citation.path);
          continue;
        }
        scope = resolution.text;
      }
      visited.add(nodeKey);
      stack.push(nodeKey);
      walk(scope, depth + 1);
      stack.pop();
    }
  };

  walk(options.content, 0);
  const fragmentList = [...fragments.values()].sort((a, b) =>
    a.path === b.path ? (a.anchor ?? '').localeCompare(b.anchor ?? '') : a.path.localeCompare(b.path));
  return {
    terminal: [...new Set(fragmentList.map((fragment) => fragment.path))].sort(),
    fragments: fragmentList,
    unresolved: [...unresolved].sort(),
    cycles,
    depthExceeded,
  };
}

/**
 * The terminal proofs the previous body reached and the candidate no longer
 * does. Deterministic: no model judgement, only the citation closure. A lost
 * fragment means an earlier contribution vanished without a declared
 * replacement — the writer must then keep the previous page rather than
 * publish a page that silently drops it.
 */
export function detectSourceLoss(
  previousContent: string,
  candidateContent: string,
  options: { resolvePage?: (pagePath: string) => string | null; maxDepth?: number } = {},
): TerminalFragment[] {
  const previous = deriveTerminalSources({ content: previousContent, ...options });
  const candidate = deriveTerminalSources({ content: candidateContent, ...options });
  const keptKeys = new Set(candidate.fragments.map((fragment) => `${fragment.path}#${fragment.anchor ?? ''}`));
  const candidatePaths = new Set(candidate.fragments.map((fragment) => fragment.path));
  // A candidate that cites the WHOLE file (no anchor) still covers an earlier
  // section of it; a bare previous citation is itself a whole-file proof, so
  // any candidate citation to that file keeps it. Only a precise section can
  // be "lost" when the file remains cited by other sections.
  const candidateWholeFilePaths = new Set(
    candidate.fragments.filter((fragment) => fragment.anchor === null).map((fragment) => fragment.path),
  );
  return previous.fragments.filter((fragment) => {
    if (fragment.anchor === null) return !candidatePaths.has(fragment.path);
    if (keptKeys.has(`${fragment.path}#${fragment.anchor}`)) return false;
    return !candidateWholeFilePaths.has(fragment.path);
  });
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
