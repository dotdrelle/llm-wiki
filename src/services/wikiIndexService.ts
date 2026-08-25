import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { safeWriteFile } from '../utils/fs.ts';
import { toPosix } from '../utils/path.ts';
import { pageTitle } from '../utils/pageTitle.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';

/*
 `wiki/index.md` used to be written by the consolidation LLM, per source, as
 one operation among the others in its response. It was fed the current index
 content and told to keep it current — but nothing enforced that it actually
 did: on a real workspace the bullet count oscillated between 4 and 7 across
 13 consecutive ingests instead of growing, and after those 13 ingests the
 index listed 2 of the 22 concept pages that actually existed on disk. An LLM
 asked to reproduce a growing list verbatim, alongside its real per-source
 work, is not a reliable place to keep the wiki's own table of contents.

 This module replaces that with the same discipline already used for
 `wiki/concepts-grid.md` and the taxonomy registry: the index is a deterministic
 projection of what is actually on disk, regenerated wholesale after every
 command that can add, move or remove a concept or source page. It never asks
 the model anything.
*/

const CONCEPTS_GLOB = 'wiki/concepts/**/*.md';
const SOURCES_GLOB = 'wiki/sources/*.md';
const INDEX_RELATIVE_PATH = 'wiki/index.md';

const HEADER = [
  '# Wiki Index',
  '',
  'This file is the canonical map of the local wiki.',
  '',
].join('\n');

const CONCEPTS_INTRO = 'Durable wiki knowledge extracted from sources: systems, actors, requirements, decisions, rules, risks, workflows, and reusable domain concepts.';
const SOURCES_INTRO = 'Source notes summarize individual ingested documents and cite their archived raw source.';

const FOOTER = [
  '## Deliverables',
  '',
  '- Templates live in `templates/`.',
  '- Shared build-only generation rules live in `build-context/`.',
  '- Generated documents live in `deliverables/`.',
  '',
].join('\n');

export type WikiIndexEntry = { path: string; label: string };

function entryLabel(raw: string, fallback: string): string {
  const parsed = matter(raw);
  const title = pageTitle(parsed);
  if (title) return title;
  // `subject` is a slug-like identity key (shared with sister feuilles under
  // the concept axes model), not meant for display — it only stands in when
  // a page has neither a frontmatter title nor a heading.
  if (typeof parsed.data?.subject === 'string' && parsed.data.subject.trim()) return parsed.data.subject.trim();
  return fallback;
}

/** Bounded pool: an unbounded Promise.all would open one readFile per page at once. */
const PAGE_READ_CONCURRENCY = 8;

async function listEntries(rootDir: string, glob: string): Promise<WikiIndexEntry[]> {
  const files = (await fg(glob, { cwd: rootDir })).map(toPosix).sort();
  const entries = await mapWithConcurrency(files, PAGE_READ_CONCURRENCY, async (file): Promise<WikiIndexEntry | null> => {
    let raw: string;
    try {
      raw = await readFile(path.join(rootDir, file), 'utf8');
    } catch {
      // Listed then deleted between the glob and the read: not this
      // regeneration's problem, the next one will simply not see it either.
      return null;
    }
    const fallback = path.basename(file).replace(/\.md$/, '');
    // Links are relative to `wiki/`, the browser's serving root — the same
    // convention every hand-written and model-written index entry already used.
    return { path: file.replace(/^wiki\//, ''), label: entryLabel(raw, fallback) };
  });
  return entries.filter((entry) => entry !== null);
}

function renderSection(title: string, intro: string, entries: WikiIndexEntry[], emptyLine: string): string {
  const body = entries.length
    ? entries.map((entry) => `- [${entry.label}](${entry.path})`).join('\n')
    : `- ${emptyLine}`;
  return [`## ${title}`, '', intro, '', body, ''].join('\n');
}

/**
 * Rebuilds `wiki/index.md` from what is actually on disk. Idempotent and safe
 * to call after any command that touches `wiki/concepts/**` or `wiki/sources/*`
 * — ingest, `concepts --apply` (grid changes leave pages untouched but this
 * stays cheap enough to call anyway), `reclassify-concepts --apply`. Never
 * throws: an index rebuild failing must not take down the mutation that
 * triggered it.
 */
export async function regenerateWikiIndex(
  rootDir: string,
): Promise<{ status: 'written'; concepts: number; sources: number } | { status: 'failed'; error: unknown }> {
  try {
    const [concepts, sources] = await Promise.all([
      listEntries(rootDir, CONCEPTS_GLOB),
      listEntries(rootDir, SOURCES_GLOB),
    ]);
    const content = [
      HEADER,
      renderSection('Concepts', CONCEPTS_INTRO, concepts, 'No concepts yet.'),
      renderSection('Sources', SOURCES_INTRO, sources, 'No source notes yet.'),
      FOOTER,
    ].join('\n');
    await safeWriteFile(path.join(rootDir, INDEX_RELATIVE_PATH), content);
    return { status: 'written', concepts: concepts.length, sources: sources.length };
  } catch (error) {
    return { status: 'failed', error };
  }
}
