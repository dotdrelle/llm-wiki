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

// ── OKF v0.2 catch-up ────────────────────────────────────────────────────────
//
// The rupture the refonte report records, as a manual phase: `timestamp` →
// `generated`, a trailing `## Citations` section → frontmatter `sources`, and
// a missing `status` → `draft`. Deliberately NOT wired into ingest — a bulk
// write would take the global `workspace-write` lock (PlanOKF.md, phase 3) —
// and deliberately conservative: a Citations section that is NOT the last
// section of the body is left in place and reported, never half-moved.

const CITATIONS_HEADING = /^#{1,3}\s+Citations\s*$/im;
const SRC_MARKER = /\[src:\s*([^\]]+)\]/g;

/** What the v0.2 migration would change on one file, and why. */
export type OkfV02Migration = { file: string; reasons: string[] };

export function migrateOkfV02(content: string): { content: string; reasons: string[] } {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };
  const reasons: string[] = [];

  if (data.timestamp != null && data.generated == null) {
    const raw = data.timestamp;
    // gray-matter (js-yaml) parses an ISO timestamp into a Date instance;
    // both shapes migrate to the same ISO string.
    const at = raw instanceof Date && !Number.isNaN(raw.getTime())
      ? raw.toISOString()
      : typeof raw === 'string' && !Number.isNaN(Date.parse(raw))
        ? raw
        : new Date().toISOString();
    data.generated = { by: 'llm-wiki', at };
    delete data.timestamp;
    reasons.push('timestamp → generated');
  }
  if (data.status == null) {
    data.status = 'draft';
    reasons.push('status: draft');
  }

  // The Citations section moves ONLY when it is the trailing section — the
  // generated shape. Mid-document it stays and is reported as manual.
  let body = parsed.content;
  const match = CITATIONS_HEADING.exec(body);
  let citations: string[] = [];
  if (match) {
    const sectionStart = match.index;
    const rest = body.slice(sectionStart);
    const lines = rest.split('\n');
    const headingLevel = (lines[0]?.match(/^#+/) ?? [''])[0].length;
    let end = lines.length;
    for (let i = 1; i < lines.length; i += 1) {
      const level = (lines[i].match(/^#+/) ?? [''])[0].length;
      if (level > 0 && level <= headingLevel) {
        end = i;
        break;
      }
    }
    const sectionLines = lines.slice(0, end);
    const sectionText = sectionLines.join('\n');
    if (end === lines.length) {
      citations = [...sectionText.matchAll(SRC_MARKER)].map((entry) => entry[1].trim()).filter(Boolean);
      body = body.slice(0, sectionStart).replace(/\n+$/, '\n');
      reasons.push(`Citations section → sources (${citations.length} source(s))`);
    } else {
      reasons.push('Citations section not trailing — left for a manual move');
    }
  }

  if (citations.length > 0) {
    const existing = Array.isArray(data.sources) ? data.sources : [];
    const known = new Set(existing.map((entry) => String(entry?.path ?? '')));
    data.sources = [
      ...existing,
      ...citations.filter((citation) => !known.has(citation)).map((citation) => ({ path: citation })),
    ];
  }

  if (reasons.length === 0) return { content, reasons };
  return { content: matter.stringify(body, data), reasons };
}

/** Bundle files the v0.2 migration would touch, in path order. */
export async function listBundleFilesV02Migration(rootDir: string): Promise<OkfV02Migration[]> {
  const files = await listBundleMarkdownFiles(rootDir);
  const migrations: OkfV02Migration[] = [];
  for (const file of files) {
    if (!okfTypeForPath(file)) continue;
    let content: string;
    try {
      content = await readFile(path.join(rootDir, file), 'utf8');
    } catch {
      continue;
    }
    const { reasons } = migrateOkfV02(content);
    if (reasons.length > 0) migrations.push({ file, reasons });
  }
  return migrations;
}

/**
 * Applies the v0.2 migration to every bundle file that needs it. Idempotent:
 * a migrated file reports no reasons on the next scan, and the diff stays
 * one line per file.
 */
export async function applyOkfV02Migration(
  rootDir: string,
): Promise<{ written: string[]; skipped: string[] }> {
  const migrations = await listBundleFilesV02Migration(rootDir);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const migration of migrations) {
    const absolutePath = path.join(rootDir, migration.file);
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch {
      skipped.push(migration.file);
      continue;
    }
    const { content: next } = migrateOkfV02(content);
    if (next === content) {
      skipped.push(migration.file);
      continue;
    }
    await safeWriteFile(absolutePath, next);
    written.push(migration.file);
  }
  return { written, skipped };
}
