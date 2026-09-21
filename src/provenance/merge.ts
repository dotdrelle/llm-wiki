import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { splitMarkdownSections } from '../utils/markdown.ts';
import { subjectsShareEntityRoot } from '../ingest/provenance.ts';
import { applyDerivedSources } from './write.ts';

/*
 * Item 1: deterministic multi-source.
 *
 * The model composes multi-source leaves only sometimes (measured: 8 then 2
 * across two runs). This pass removes that lottery for the case the engine can
 * decide alone: two leaves of the SAME concept whose subjects share their
 * entity root (`prophix` and `prophix-one`) are one subject split in two. They
 * are merged by construction — bodies appended section by section, sources
 * unioned — and the duplicate is removed. Nothing semantic is invented: the
 * text is the union of what already existed.
 *
 * Run on a COPY; `apply` is opt-in.
 */

export interface MergeGroup {
  concept: string;
  canonical: string;
  merged: string[];
  sources: number;
}

export interface MergeReport {
  scannedLeaves: number;
  groupsMerged: number;
  leavesRemoved: number;
  groups: MergeGroup[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function subjectOf(content: string, relPath: string): string {
  try {
    const value = matter(content).data?.subject;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // fall through to the filename
  }
  return path.basename(relPath, '.md');
}

function headingsOf(content: string): Set<string> {
  const out = new Set<string>();
  for (const section of splitMarkdownSections(content).sections) {
    if (!section.headingText) continue;
    out.add(section.headingText.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim());
  }
  return out;
}

function bodyOf(content: string): string {
  try {
    return matter(content).content.trim();
  } catch {
    return String(content).trim();
  }
}

/** Append the sibling's sections the canonical page does not already carry. */
function mergeBodies(canonical: string, sibling: string): string {
  const existing = headingsOf(canonical);
  const additions = splitMarkdownSections(sibling).sections
    .filter((section) => section.headingText)
    .filter((section) => {
      const key = section.headingText.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      return !existing.has(key);
    })
    .map((section) => section.markdown.trim())
    .filter(Boolean);
  const base = bodyOf(canonical);
  return additions.length ? `${base}\n\n${additions.join('\n\n')}` : base;
}

export function planMergeGroups(leaves: Array<{ path: string; concept: string; subject: string }>): MergeGroup[] {
  const groups: MergeGroup[] = [];
  const byConcept = new Map<string, Array<{ path: string; subject: string }>>();
  for (const leaf of leaves) {
    const list = byConcept.get(leaf.concept) ?? [];
    list.push({ path: leaf.path, subject: leaf.subject });
    byConcept.set(leaf.concept, list);
  }
  for (const [concept, entries] of byConcept) {
    const used = new Set<string>();
    for (const entry of entries) {
      if (used.has(entry.path)) continue;
      // Canonical: the subject that IS the root, else the shortest.
      const family = entries.filter((other) => !used.has(other.path) && subjectsShareEntityRoot(entry.subject, other.subject));
      if (family.length < 2) continue;
      family.sort((a, b) => a.subject.length - b.subject.length || a.path.localeCompare(b.path));
      const canonical = family[0];
      const merged = family.slice(1).map((item) => item.path);
      for (const item of family) used.add(item.path);
      groups.push({ concept, canonical: canonical.path, merged, sources: family.length });
    }
  }
  return groups;
}

export async function mergeDuplicateLeaves(options: { rootDir: string; apply?: boolean }): Promise<MergeReport> {
  const rootDir = path.resolve(options.rootDir);
  const conceptsDir = path.join(rootDir, 'wiki', 'concepts');
  const leaves: Array<{ path: string; concept: string; subject: string }> = [];
  const contents = new Map<string, string>();

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
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = toPosix(path.relative(rootDir, absolute));
        const concept = toPosix(path.relative(conceptsDir, dir)).split('/')[0] || 'unclassified';
        const content = readFileSync(absolute, 'utf8');
        contents.set(rel, content);
        leaves.push({ path: rel, concept, subject: subjectOf(content, rel) });
      }
    }
  };
  await walk(conceptsDir);

  const groups = planMergeGroups(leaves);
  for (const group of groups) {
    if (!options.apply) continue;
    const canonicalAbsolute = path.join(rootDir, group.canonical);
    let merged = contents.get(group.canonical) ?? '';
    for (const duplicate of group.merged) {
      merged = mergeBodies(merged, contents.get(duplicate) ?? '');
      contents.set(group.canonical, merged);
    }
    // Recompute `sources:` from the merged body's closure.
    const resolvePage = (pagePath: string): string | null => contents.get(pagePath) ?? null;
    const derived = applyDerivedSources(merged, { resolvePage });
    if (derived.clean) {
      writeFileSync(canonicalAbsolute, derived.content, 'utf8');
    }
    for (const duplicate of group.merged) {
      const absolute = path.join(rootDir, duplicate);
      if (existsSync(absolute)) rmSync(absolute, { force: true });
      contents.delete(duplicate);
    }
  }

  return {
    scannedLeaves: leaves.length,
    groupsMerged: groups.length,
    leavesRemoved: groups.reduce((sum, group) => sum + group.merged.length, 0),
    groups,
  };
}
