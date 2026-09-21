import { existsSync, readFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyDerivedSources } from './write.ts';

/*
 * Lot 6 (deterministic half): rebuild the `sources:` inventory of an existing
 * corpus from each page's body closure. No LLM, no re-synthesis, no new page:
 * it only makes the declared inventory match what the body actually reaches
 * (drops phantom sources, adds undeclared ones). A page whose closure does not
 * resolve cleanly is left untouched and reported.
 *
 * Run it on a COPY first (the plan's rule); the active wiki is never migrated
 * by accident.
 */

export interface RebuildFileResult {
  path: string;
  changed: boolean;
  clean: boolean;
  terminal: string[];
  missing: string[];
  undeclared: string[];
  unresolved: string[];
}

export interface RebuildReport {
  scanned: number;
  changed: number;
  degraded: number;
  phantomEntriesRemoved: number;
  undeclaredAdded: number;
  files: RebuildFileResult[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

async function listPages(rootDir: string): Promise<string[]> {
  const roots = ['wiki/concepts', 'wiki/sources'];
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(toPosix(path.relative(rootDir, absolute)));
    }
  };
  for (const root of roots) await walk(path.join(rootDir, root));
  return out.sort();
}

export async function rebuildProvenance(options: { rootDir: string; apply?: boolean }): Promise<RebuildReport> {
  const rootDir = path.resolve(options.rootDir);
  const pages = await listPages(rootDir);

  // Load everything first so a rewrite cannot affect a later closure read.
  const contents = new Map<string, string>();
  for (const rel of pages) {
    try {
      contents.set(rel, readFileSync(path.join(rootDir, rel), 'utf8'));
    } catch {
      // An unreadable page is skipped, never fatal.
    }
  }
  const resolvePage = (pagePath: string): string | null => {
    const fromMemory = contents.get(pagePath);
    if (fromMemory != null) return fromMemory;
    try {
      const absolute = path.join(rootDir, pagePath);
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    } catch {
      return null;
    }
  };

  const files: RebuildFileResult[] = [];
  for (const rel of pages) {
    const before = contents.get(rel);
    if (before == null) continue;
    const result = applyDerivedSources(before, { resolvePage });
    const changed = result.clean && result.content !== before;
    if (changed && options.apply) {
      await writeFile(path.join(rootDir, rel), result.content, 'utf8');
    }
    files.push({
      path: rel,
      changed,
      clean: result.clean,
      terminal: result.terminal,
      missing: result.integrity.missing,
      undeclared: result.integrity.undeclared,
      unresolved: result.unresolved,
    });
  }

  return {
    scanned: files.length,
    changed: files.filter((file) => file.changed).length,
    degraded: files.filter((file) => !file.clean).length,
    phantomEntriesRemoved: files.reduce((sum, file) => sum + file.missing.length, 0),
    undeclaredAdded: files.reduce((sum, file) => sum + file.undeclared.length, 0),
    files,
  };
}
