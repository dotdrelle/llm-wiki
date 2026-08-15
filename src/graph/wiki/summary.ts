/**
 * Context summary of a wiki page, for the graph's floating card.
 *
 * The reader who clicks on an isolated page does not want to read it whole:
 * they want to know what it is about before deciding to go there. Three lines
 * suffice, but they must be a synthesis — a first paragraph torn from the file
 * says what is at the top of the page, not what it contains.
 *
 * The summary is therefore produced by the configured LLM and cached on disk,
 * indexed by the file's fingerprint: an unchanged page is only summarized
 * once, and an ingest that rewrites it invalidates the entry without us having
 * to purge anything. With no LLM configured, or if it fails, we return the
 * excerpt — worse, but never nothing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type GraphDocumentSummary = {
  id: string;
  title: string;
  summary: string;
  source: 'llm' | 'excerpt';
};

type CacheEntry = { contentEtag: string; summary: string };
type CacheFile = Record<string, CacheEntry>;

const SUMMARY_SYSTEM = [
  'You summarize a single page of a personal knowledge wiki.',
  'Answer with 2 to 4 short sentences of plain prose, no heading, no bullet list, no preamble.',
  'Say what the page is about and what a reader would find in it.',
  'Write in the same language as the page itself.',
].join(' ');

function cachePath(rootDir: string): string {
  return path.join(rootDir, '.wiki', 'cache', 'graph-summaries.json');
}

async function readCache(rootDir: string): Promise<CacheFile> {
  try {
    const raw = await readFile(cachePath(rootDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CacheFile) : {};
  } catch {
    // Cache missing or unreadable: it is not an error, only a cost.
    return {};
  }
}

async function writeCache(rootDir: string, cache: CacheFile): Promise<void> {
  try {
    const file = cachePath(rootDir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cache), 'utf8');
  } catch {
    // An unwritten cache will be recomputed: never anything to fail the request
    // that produced it.
  }
}

/**
 * Fallback excerpt: first sentences of the text already cleaned by
 * `markdownPreviewForGraph` (frontmatter, code blocks and markup removed).
 */
export function excerptSummary(preview: string): string {
  const text = String(preview ?? '').trim();
  if (!text) return 'This page has no readable content yet.';
  // Each capture carries the space that precedes it: gluing them back as-is
  // would double the blanks between sentences.
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim());
  const joined = (sentences ? sentences.slice(0, 3).join(' ') : text).trim();
  return joined.length > 420 ? `${joined.slice(0, 417).trimEnd()}…` : joined;
}

export async function graphDocumentSummary(options: {
  rootDir: string;
  id: string;
  title: string;
  preview: string;
  contentEtag: string;
  complete?: (request: { system: string; user: string }) => Promise<string>;
}): Promise<GraphDocumentSummary> {
  const { rootDir, id, title, preview, contentEtag, complete } = options;
  const base = { id, title };
  if (!complete) return { ...base, summary: excerptSummary(preview), source: 'excerpt' };

  const cache = await readCache(rootDir);
  const hit = cache[id];
  if (hit?.contentEtag === contentEtag && hit.summary) {
    return { ...base, summary: hit.summary, source: 'llm' };
  }

  try {
    const answer = (
      await complete({
        system: SUMMARY_SYSTEM,
        user: `Page: ${title}\nPath: ${id}\n\n---\n${preview}\n---`,
      })
    ).trim();
    if (!answer) return { ...base, summary: excerptSummary(preview), source: 'excerpt' };
    cache[id] = { contentEtag, summary: answer };
    await writeCache(rootDir, cache);
    return { ...base, summary: answer, source: 'llm' };
  } catch {
    // Provider unreachable, quota, missing model: the card still opens.
    return { ...base, summary: excerptSummary(preview), source: 'excerpt' };
  }
}
