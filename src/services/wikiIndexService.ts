import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { pathExists, safeWriteFile } from '../utils/fs.ts';
import { toPosix } from '../utils/path.ts';
import { pageTitle } from '../utils/pageTitle.ts';
import { mapWithConcurrency } from '../utils/concurrency.ts';
import { applyOkfFrontmatter, OKF_TYPE_INDEX } from '../okf/frontmatter.ts';

/*
 `wiki/index.md` used to be written by the consolidation LLM, per source, as
 one operation among the others in its response. It was fed the current index
 content and told to keep it current — but nothing enforced that it actually
 did: on a real workspace the bullet count oscillated between 4 and 7 across
 13 consecutive ingests instead of growing, and after those 13 ingests the
 index listed 2 of the 22 concept pages that actually existed on disk. An LLM
 asked to reproduce a growing list verbatim, alongside its real per-source
 work, is not a reliable place to keep the wiki's own table of contents.

 This module replaces that with a deterministic generated inventory. The
 project-knowledge, reading-note, and archived-document lists reflect what is
 actually on disk, while a bounded workspace-overview block is preserved
 across regeneration. No growing page list is delegated to the model.
*/

const CONCEPTS_GLOB = 'wiki/concepts/**/*.md';
const SOURCES_GLOB = 'wiki/sources/*.md';
const ARCHIVES_GLOB = 'raw/ingested/**/*.md';
const INDEX_RELATIVE_PATH = 'wiki/index.md';
const OVERVIEW_START = '<!-- wiki-index-overview:start -->';
const OVERVIEW_END = '<!-- wiki-index-overview:end -->';

const HEADER = [
  '# Wiki Index',
  '',
  'This file is the canonical map of the local wiki.',
  '',
  '<!-- Edit between these markers; this content survives index regeneration. -->',
].join('\n');

const CONCEPTS_INTRO = 'Reusable knowledge about this workspace, organized around the concepts found in its material.';
const SOURCES_INTRO = 'Reading notes summarize individual documents; each note cites its complete archived original.';
const ARCHIVES_INTRO = 'Original ingested documents, preserved as evidence and searchable when a detail is missing from a reading note.';

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
  // `subject` is the page's display label; the opaque `subject_id` carries its
  // identity. Use the label only when there is no title or heading.
  if (typeof parsed.data?.subject === 'string' && parsed.data.subject.trim()) return parsed.data.subject.trim();
  return fallback;
}

/** Bounded pool: an unbounded Promise.all would open one readFile per page at once. */
const PAGE_READ_CONCURRENCY = 8;

async function listEntries(
  rootDir: string,
  glob: string,
  linkRoot: 'wiki' | 'raw' = 'wiki',
): Promise<WikiIndexEntry[]> {
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
    // Wiki links are relative to `wiki/`; archived originals live beside it,
    // so their links step up once and point into raw/ingested/.
    const link = linkRoot === 'raw' ? `../${file}` : file.replace(/^wiki\//, '');
    return { path: link, label: entryLabel(raw, fallback) };
  });
  return entries.filter((entry) => entry !== null);
}

function renderSection(title: string, intro: string, entries: WikiIndexEntry[], emptyLine: string): string {
  const body = entries.length
    ? entries.map((entry) => `- [${entry.label}](${entry.path})`).join('\n')
    : `- ${emptyLine}`;
  return [`## ${title}`, '', intro, '', body, ''].join('\n');
}

export function readWorkspaceOverview(currentIndex: string): string {
  const start = currentIndex.indexOf(OVERVIEW_START);
  const end = currentIndex.indexOf(OVERVIEW_END);
  if (start === -1 && end === -1) {
    const legacyBody = matter(currentIndex).content.trim();
    if (!legacyBody || legacyBody === '# Wiki Index') return '';
    throw new Error('Workspace overview markers are missing; existing index content was preserved. Add the overview markers before regenerating the index.');
  }
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    currentIndex.indexOf(OVERVIEW_START, start + OVERVIEW_START.length) !== -1 ||
    currentIndex.indexOf(OVERVIEW_END, end + OVERVIEW_END.length) !== -1
  ) {
    throw new Error('Workspace overview markers are missing, duplicated, or out of order; index was not regenerated.');
  }
  return currentIndex
    .slice(start + OVERVIEW_START.length, end)
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '');
}

export function replaceWorkspaceOverview(currentIndex: string, overview: string): string {
  const start = currentIndex.indexOf(OVERVIEW_START);
  const end = currentIndex.indexOf(OVERVIEW_END);
  // Validate marker count and order before changing any user content.
  readWorkspaceOverview(currentIndex);
  if (start < 0 || end < start) {
    throw new Error('Workspace overview markers are missing; index was not changed.');
  }
  return `${currentIndex.slice(0, start + OVERVIEW_START.length)}\n${overview.trim()}\n${currentIndex.slice(end)}`;
}

function renderWorkspaceOverview(overview: string): string {
  return [OVERVIEW_START, overview, OVERVIEW_END, ''].join('\n');
}

export async function buildWikiIndex(rootDir: string, overview: string): Promise<{
  content: string;
  concepts: number;
  sources: number;
  archives: number;
}> {
  const [concepts, sources, archives] = await Promise.all([
    listEntries(rootDir, CONCEPTS_GLOB),
    listEntries(rootDir, SOURCES_GLOB),
    listEntries(rootDir, ARCHIVES_GLOB, 'raw'),
  ]);
  const content = applyOkfFrontmatter(
    [
      HEADER,
      renderWorkspaceOverview(overview),
      renderSection('Project knowledge', CONCEPTS_INTRO, concepts, 'No project knowledge pages yet.'),
      renderSection('Reading notes', SOURCES_INTRO, sources, 'No reading notes yet.'),
      renderSection('Archived documents', ARCHIVES_INTRO, archives, 'No archived documents yet.'),
      FOOTER,
    ].join('\n'),
    { type: OKF_TYPE_INDEX, title: 'Wiki Index' },
  );
  return { content, concepts: concepts.length, sources: sources.length, archives: archives.length };
}

/**
 * Rebuilds the generated inventories in `wiki/index.md` from what is actually on disk,
 * preserving the marked workspace overview. Idempotent and safe
 * to call after any command that touches `wiki/concepts/**` or `wiki/sources/*`
 * — ingest, `concepts --apply` (grid changes leave pages untouched but this
 * stays cheap enough to call anyway). Never
 * throws: an index rebuild failing must not take down the mutation that
 * triggered it.
 */
export async function regenerateWikiIndex(
  rootDir: string,
): Promise<{ status: 'written'; concepts: number; sources: number; archives: number } | { status: 'failed'; error: unknown }> {
  try {
    const indexPath = path.join(rootDir, INDEX_RELATIVE_PATH);
    const workspaceOverview = await pathExists(indexPath)
      ? readWorkspaceOverview(await readFile(indexPath, 'utf8'))
      : '';
    const generated = await buildWikiIndex(rootDir, workspaceOverview);
    await safeWriteFile(indexPath, generated.content);
    return { status: 'written', concepts: generated.concepts, sources: generated.sources, archives: generated.archives };
  } catch (error) {
    return { status: 'failed', error };
  }
}
