import { declaredSourcePaths } from './sourcePaths.ts';
import matter from 'gray-matter';
import {
  deriveTerminalSources,
  type SourcesIntegrity,
  validateSourcesIntegrity,
} from './derive.ts';

/*
 * Write-side provenance helpers derive `sources:` from the body's citation
 * closure rather than blindly carrying an old inventory forward. Provenance
 * derivation is always on; callers preserve content when resolution is incomplete.
 */

export interface ApplyDerivedSourcesOptions {
  /** Body of a cited `wiki/` page, or null when unreadable. */
  resolvePage?: (pagePath: string) => string | null;
  maxDepth?: number;
}

export interface ApplyDerivedSourcesResult {
  /** Rewritten content, or the input unchanged when the closure is not clean. */
  content: string;
  terminal: string[];
  integrity: SourcesIntegrity;
  /** True when the closure resolved fully (no missing target, cycle or ceiling). */
  clean: boolean;
  unresolved: string[];
  cycles: string[][];
  depthExceeded: boolean;
}



/**
 * Replace the `sources:` inventory with the derived list. A path already
 * present keeps its record (so a human-set `usage_count` survives); a new path
 * is added with `usage_count: 0`. Every other frontmatter key is untouched.
 */
export function rewriteSourcesInventory(content: string, terminalPaths: string[]): string {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };
  const existing = Array.isArray(data.sources) ? data.sources : [];
  const byPath = new Map<string, Record<string, unknown>>();
  for (const entry of existing) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const path = String(record.path ?? '').replace(/\\/g, '/');
    if (path) byPath.set(path, { ...record, path });
  }
  if (terminalPaths.length === 0) {
    delete data.sources;
  } else {
    data.sources = terminalPaths.map((path) => byPath.get(path) ?? { path, usage_count: 0 });
  }
  return matter.stringify(parsed.content, data);
}

export function applyDerivedSources(
  content: string,
  options: ApplyDerivedSourcesOptions = {},
): ApplyDerivedSourcesResult {
  const derived = deriveTerminalSources({
    content,
    ...(options.resolvePage ? { resolvePage: options.resolvePage } : {}),
    ...(options.maxDepth != null ? { maxDepth: options.maxDepth } : {}),
  });
  const declared = declaredSourcePaths((matter(content).data ?? {}) as Record<string, unknown>);
  const integrity = validateSourcesIntegrity(declared, derived.terminal);
  const clean = derived.unresolved.length === 0 && derived.cycles.length === 0 && !derived.depthExceeded;

  return {
    // A degraded closure keeps the page's existing inventory: dropping a source
    // because a citation could not be followed is exactly the loss the invariant
    // exists to prevent.
    content: clean ? rewriteSourcesInventory(content, derived.terminal) : content,
    terminal: derived.terminal,
    integrity,
    clean,
    unresolved: derived.unresolved,
    cycles: derived.cycles,
    depthExceeded: derived.depthExceeded,
  };
}
