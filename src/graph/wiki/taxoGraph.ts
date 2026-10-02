import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { graphEtagForFiles, listGraphFiles } from '../../serve/html/wikiHtml.ts';
import { toPosix } from '../../utils/path.ts';
import { layoutTaxoGraph, type TaxoLayout } from './taxoLayout.ts';

/**
 * The TAXO reading of the wiki, as the graph page draws it.
 *
 * Three kinds of node and one kind of link, all read from what ingest already
 * wrote — no model call, no registry:
 *
 * - a **concept** is a tag pivot `wiki/concepts/<family>/<tag>.md`, whose
 *   `family` front-matter names its family;
 * - a **source** is a section fiche under `wiki/sources/**`;
 * - a **link** joins a concept to every fiche its page cites (`[src: …]`).
 *
 * Families are derived from the concepts; the browser derives the rest
 * (co-citation between concepts, sources shared between families) so the four
 * views read one payload. Ids are the pages' workspace-relative paths, so the
 * context card's summary and preview routes take them unchanged.
 */
export interface TaxoGraphNode {
  id: string;
  type: 'concept' | 'source';
  title: string;
  family?: string;
  desc: string | null;
  path: string;
  /** Source only: the folder of the document the fiche belongs to. */
  folder?: string;
}

export interface TaxoGraph {
  etag: string;
  families: string[];
  nodes: TaxoGraphNode[];
  links: Array<{ source: string; target: string }>;
  layout: TaxoLayout;
}

const CONCEPTS = 'wiki/concepts/';
const SOURCES = 'wiki/sources/';
const CITATION = /\[src:\s*(wiki\/sources\/[^\]\s#]+\.md)/g;

function humanize(value: string): string {
  const text = value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : value;
}

function text(value: unknown): string | null {
  const result = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return result || null;
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match ? match[1]!.trim() : null;
}

const cache = new Map<string, TaxoGraph>();

export async function loadTaxoGraph(rootDir: string): Promise<TaxoGraph> {
  const files = (await listGraphFiles(rootDir)).map(toPosix)
    .filter((file) => file.endsWith('.md') && (file.startsWith(CONCEPTS) || file.startsWith(SOURCES)));
  const etag = await graphEtagForFiles(rootDir, files);
  const cached = cache.get(rootDir);
  if (cached?.etag === etag) return cached;

  const pages = await Promise.all(files.map(async (file) => {
    try {
      const parsed = matter(await readFile(path.join(rootDir, file), 'utf8'));
      return { file, data: parsed.data as Record<string, unknown>, body: parsed.content };
    } catch {
      // A malformed front-matter is lint's to report; the graph skips the page.
      return null;
    }
  }));

  const nodes: TaxoGraphNode[] = [];
  const links: Array<{ source: string; target: string }> = [];
  const sourceIds = new Set<string>();
  const familyCounts = new Map<string, number>();

  for (const page of pages) {
    if (!page || !page.file.startsWith(SOURCES)) continue;
    const relative = page.file.slice(SOURCES.length);
    const folder = path.posix.dirname(relative);
    sourceIds.add(page.file);
    nodes.push({
      id: page.file,
      type: 'source',
      title: text(page.data.title) ?? firstHeading(page.body) ?? humanize(path.posix.basename(page.file, '.md')),
      desc: text(page.data.description),
      path: page.file,
      // A transport id opening an exported folder name is not part of it.
      folder: folder === '.' ? '' : humanize(path.posix.basename(folder).replace(/^(?=[0-9a-f]{8,}[-_])[0-9a-f]*[a-f][0-9a-f]*[-_]+/i, '')),
    });
  }

  for (const page of pages) {
    if (!page || !page.file.startsWith(CONCEPTS)) continue;
    const parts = page.file.slice(CONCEPTS.length).split('/');
    const family = text(page.data.family) ?? (parts.length > 1 ? humanize(parts[0]!) : 'Unclassified');
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    nodes.push({
      id: page.file,
      type: 'concept',
      title: text(page.data.title) ?? firstHeading(page.body) ?? humanize(path.posix.basename(page.file, '.md')),
      family,
      desc: text(page.data.description),
      path: page.file,
    });
    const cited = new Set<string>();
    for (const match of page.body.matchAll(CITATION)) {
      const target = match[1]!;
      if (sourceIds.has(target) && !cited.has(target)) {
        cited.add(target);
        links.push({ source: page.file, target });
      }
    }
  }

  const families = [...familyCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const graph: TaxoGraph = { etag, families, nodes, links, layout: { family: {}, concepts: {}, full: {} } };
  graph.layout = layoutTaxoGraph(graph);
  cache.set(rootDir, graph);
  return graph;
}
