import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { safeWriteFile } from '../utils/fs.ts';
import { toPosix } from '../utils/path.ts';
import { applyOkfFrontmatter, okfTypeForPath } from './frontmatter.ts';

/*
 Bundle scan for the OKF catch-up.

 The bundle is `wiki/**` plus `deliverables/**` — everything OKF describes as
 published knowledge. Raw inputs, templates, build context and `.wiki` state are
 out. This scan is what both `wiki doctor` (list + `--apply`) and the lint rule
 read, so the two can never disagree about which files lack a `type`.
 */

const BUNDLE_PATTERNS = ['wiki/**/*.md', 'deliverables/**/*.md'];

export async function listBundleMarkdownFiles(rootDir: string): Promise<string[]> {
  return (await fg(BUNDLE_PATTERNS, { cwd: rootDir, dot: false })).map(toPosix).sort();
}

/** Bundle files whose frontmatter lacks a valid OKF `type`, in path order. */
export async function listBundleFilesMissingType(rootDir: string): Promise<string[]> {
  const files = await listBundleMarkdownFiles(rootDir);
  const missing: string[] = [];
  for (const file of files) {
    if (!okfTypeForPath(file)) continue;
    let content: string;
    try {
      content = await readFile(path.join(rootDir, file), 'utf8');
    } catch {
      // Listed then deleted between the glob and the read: not this scan's
      // problem, the next one will simply not see it either.
      continue;
    }
    const { data } = matter(content);
    if (typeof data.type !== 'string' || !data.type.trim()) missing.push(file);
  }
  return missing;
}

/**
 * Writes the missing OKF `type` into every bundle file that lacks one.
 *
 * Idempotent and re-runnable: `applyOkfFrontmatter` is additive, so a file
 * already carrying a type is untouched and the diff stays one line per file.
 * Deliberately NOT wired into the ingest run — a bulk write would take the
 * global `workspace-write` lock and serialize everything else (see PlanOKF.md,
 * phase 3). Call it only from `wiki doctor --apply`.
 */
export async function applyMissingOkfTypes(
  rootDir: string,
): Promise<{ written: string[]; skipped: string[] }> {
  const files = await listBundleFilesMissingType(rootDir);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const type = okfTypeForPath(file);
    if (!type) {
      skipped.push(file);
      continue;
    }
    const absolutePath = path.join(rootDir, file);
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch {
      skipped.push(file);
      continue;
    }
    const next = applyOkfFrontmatter(content, { type });
    if (next === content) {
      skipped.push(file);
      continue;
    }
    await safeWriteFile(absolutePath, next);
    written.push(file);
  }
  return { written, skipped };
}
