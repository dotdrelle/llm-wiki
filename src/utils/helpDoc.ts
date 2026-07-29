import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInside } from './path.ts';

// Product help documentation reader.
//
// The documentation is a set of authored Markdown chapters bundled in the
// llm-wiki image (folder `help-doc/`). It is GLOBAL product help — it describes
// the whole system (DONNA, manager, agents, interfaces), not a workspace's wiki
// content — so it is read from a fixed bundled directory, NOT from `/workspace`,
// and is identical for every workspace.
//
// Chapters are addressed by id (filename without `.md`, e.g. `03-content-lifecycle`).
// The title is the first `# ` heading of the file. This is documentation
// navigation (table of contents + section), not the wiki page taxonomy.

export interface HelpChapter {
  id: string;
  title: string;
}

export interface HelpChapterContent {
  found: boolean;
  id: string;
  title?: string;
  content?: string;
  error?: string;
}

export interface HelpSearchResult {
  query: string;
  chapters: Array<HelpChapterContent & { score: number }>;
}

const CHAPTER_ID = /^[a-z0-9][a-z0-9-]*$/;
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'au', 'aux', 'avec', 'ce', 'ces', 'comment', 'dans', 'de',
  'des', 'du', 'en', 'est', 'et', 'for', 'how', 'is', 'la', 'le', 'les', 'of',
  'on', 'ou', 'pour', 'que', 'qui', 'the', 'to', 'un', 'une', 'what',
]);

// Resolve the bundled help-doc directory. Order: explicit env, then a path
// relative to this module (package root), then the current working directory.
// The result is invariant for the process lifetime, so it's cached after the
// first call instead of re-probing the filesystem on every request.
let cachedHelpDir: string | undefined;
export function resolveHelpDir(): string {
  if (cachedHelpDir !== undefined) return cachedHelpDir;
  const candidates: string[] = [];
  if (process.env.HELP_DOC_DIR) candidates.push(process.env.HELP_DOC_DIR);
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // src/utils -> package root, and dist/utils -> package root
    candidates.push(path.resolve(here, '..', '..', 'help-doc'));
  } catch {
    // import.meta.url unavailable — ignore
  }
  candidates.push(path.resolve(process.cwd(), 'help-doc'));
  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      cachedHelpDir = dir;
      return dir;
    }
  }
  // Fall back to the first candidate so callers surface a clear "missing" error.
  cachedHelpDir = candidates[0] ?? path.resolve(process.cwd(), 'help-doc');
  return cachedHelpDir;
}

function extractTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) return match[1];
    if (line.trim()) break; // stop at first non-empty, non-H1 line
  }
  return fallback;
}

// List documentation chapters (the table of contents), sorted by filename.
// Chapters are static bundled content for the process lifetime, so the parsed
// list is cached after the first successful read.
let cachedChapters: HelpChapter[] | undefined;
export async function listHelpChapters(dir = resolveHelpDir()): Promise<HelpChapter[]> {
  if (cachedChapters) return cachedChapters;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((name) => name.endsWith('.md') && CHAPTER_ID.test(name.slice(0, -3))).sort();
  const chapters: HelpChapter[] = [];
  for (const file of files) {
    const id = file.slice(0, -3);
    let title = id;
    try {
      const raw = await readFile(path.join(dir, file), 'utf8');
      title = extractTitle(raw, id);
    } catch {
      // unreadable file — keep id as title
    }
    chapters.push({ id, title });
  }
  cachedChapters = chapters;
  return chapters;
}

// Read one documentation chapter by id. Sanitized against path traversal.
export async function readHelpChapter(
  id: string,
  dir = resolveHelpDir(),
): Promise<HelpChapterContent> {
  const clean = String(id ?? '').trim().replace(/\.md$/, '');
  if (!CHAPTER_ID.test(clean)) {
    return { found: false, id: clean, error: 'Invalid chapter id.' };
  }
  let file: string;
  try {
    file = resolveInside(dir, `${clean}.md`);
  } catch {
    return { found: false, id: clean, error: 'Invalid chapter id.' };
  }
  if (!existsSync(file)) {
    return { found: false, id: clean, error: 'Chapter not found.' };
  }
  try {
    const content = await readFile(file, 'utf8');
    return { found: true, id: clean, title: extractTitle(content, clean), content };
  } catch {
    return { found: false, id: clean, error: 'Chapter could not be read.' };
  }
}

function searchTokens(value: string): string[] {
  return [...new Set(String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}_/-]*/gu) ?? [])]
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

// Rank the authored product documentation itself. This keeps chapter selection
// in the help service: callers only decide whether the question concerns the
// product and never hard-code chapter ids.
export async function searchHelpChapters(
  query: string,
  { dir = resolveHelpDir(), limit = 2 }: { dir?: string; limit?: number } = {},
): Promise<HelpSearchResult> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return { query, chapters: [] };
  const chapters = await listHelpChapters(dir);
  const ranked = await Promise.all(chapters.map(async ({ id, title }) => {
    const chapter = await readHelpChapter(id, dir);
    if (!chapter.found || !chapter.content) return null;
    const normalizedTitle = searchTokens(`${id} ${title}`).join(' ');
    const headings = chapter.content
      .split(/\r?\n/)
      .filter((line) => /^#{1,3}\s/.test(line))
      .join(' ');
    const normalizedHeadings = searchTokens(headings).join(' ');
    const normalizedBody = searchTokens(chapter.content).join(' ');
    const score = tokens.reduce((total, token) => total
      + (normalizedTitle.includes(token) ? 8 : 0)
      + (normalizedHeadings.includes(token) ? 4 : 0)
      + (normalizedBody.includes(token) ? 1 : 0), 0);
    return score > 0 ? { ...chapter, score } : null;
  }));
  const safeLimit = Math.max(1, Math.min(3, Math.floor(Number(limit) || 2)));
  return {
    query,
    chapters: ranked
      .filter((item): item is HelpChapterContent & { score: number } => item !== null)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, safeLimit),
  };
}
