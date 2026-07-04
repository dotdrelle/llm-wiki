import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { extractWikiLinks } from '../../utils/markdown.ts';
import { canonicalizeName, toPosix } from '../../utils/path.ts';

export type WikiGraphNodeType =
  | 'raw-source'
  | 'wiki-source'
  | 'wiki'
  | 'template'
  | 'build-context'
  | 'deliverable';

export type WikiGraphRelationType =
  | 'links_to'
  | 'cites'
  | 'generated_from'
  | 'uses_template'
  | 'uses_context'
  | 'produces'
  | 'related_to';

export interface WikiGraphNode {
  id: string;
  title: string;
  type: WikiGraphNodeType;
  href: string;
  preview: string;
  raw: string;
  html: string;
  group?: string;
  degree: number;
  x: number;
  y: number;
  r: number;
  ring: number;
  secondary: string;
  inbound: number;
  outbound: number;
}

export interface WikiGraphEdge {
  from: string;
  to: string;
  type: WikiGraphRelationType;
}

export type WikiGraphProjectionDeps = {
  decodeHrefPath: (href: string) => string;
  hrefToRelativePath: (href: string, currentDir?: string) => string;
  humanTitle: (value: string) => string;
  renderMarkdown: (raw: string, currentDir?: string) => Promise<string>;
};

/** DAG mode column order for the wiki projection — feeds GraphRenderDeps.dagColumnOrder. */
export const WIKI_GRAPH_DAG_COLUMN_ORDER: WikiGraphNodeType[] = [
  'raw-source',
  'template',
  'build-context',
  'wiki-source',
  'wiki',
  'deliverable',
];

/** Relation panel labels for the wiki projection — feeds GraphRenderDeps.relationLabels. */
export const WIKI_GRAPH_RELATION_LABELS: Record<WikiGraphRelationType, string> = {
  links_to: 'links to',
  cites: 'cites',
  generated_from: 'generated from',
  uses_template: 'uses template',
  uses_context: 'uses context',
  produces: 'produces',
  related_to: 'related to',
};

const GRAPH_PATTERNS = [
  'wiki/**/*.md',
  '!wiki/log.md',
  'deliverables/**/*.md',
  'templates/**/*.md',
  'build-context/**/*.md',
  'raw/ingested/**/*.md',
];

export async function listWikiGraphFiles(rootDir: string): Promise<string[]> {
  return (await fg(GRAPH_PATTERNS, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
}

export async function wikiGraphEtagForFiles(rootDir: string, files: string[]): Promise<string> {
  const hash = createHash('sha1');
  for (const file of files) {
    const fileStat = await stat(path.join(rootDir, file));
    hash.update(file);
    hash.update('\0');
    hash.update(String(fileStat.mtimeMs));
    hash.update('\0');
    hash.update(String(fileStat.size));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function wikiGraphEtag(rootDir: string): Promise<string> {
  return wikiGraphEtagForFiles(rootDir, await listWikiGraphFiles(rootDir));
}

export async function buildWikiGraph(
  rootDir: string,
  deps: WikiGraphProjectionDeps,
  graphFiles?: string[],
): Promise<{ nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }> {
  const files = graphFiles ?? (await listWikiGraphFiles(rootDir));
  const nodeIds = new Set(files);
  const edges: WikiGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const degree = new Map(files.map((file) => [file, 0]));
  const inbound = new Map(files.map((file) => [file, 0]));
  const outbound = new Map(files.map((file) => [file, 0]));
  const previews = new Map<string, string>();
  const rawContents = new Map<string, string>();
  const htmlContents = new Map<string, string>();
  const groups = new Map<string, string>();

  for (const file of files) {
    const raw = await readFile(path.join(rootDir, file), 'utf8');
    const currentDir = toPosix(path.posix.dirname(file));
    rawContents.set(file, raw);
    previews.set(file, markdownPreview(raw));
    htmlContents.set(file, await deps.renderMarkdown(raw, currentDir));
    const group = graphConceptGroup(file, raw);
    if (group) groups.set(file, group);

    for (const target of extractGraphTargets(raw, currentDir, nodeIds, deps)) {
      if (!nodeIds.has(target.to) || target.to === file) continue;
      const relation = relationForTarget(file, target.to, target.type);
      // Sort the pair so a mutual link (A links_to B and B links_to A) dedupes
      // to a single edge like the pre-extraction implementation did, while
      // still keying on `relation` so distinct relation types between the
      // same pair (e.g. links_to and cites) remain separate edges.
      const [pairA, pairB] = [file, target.to].sort();
      const edgeKey = `${pairA}\0${pairB}\0${relation}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ from: file, to: target.to, type: relation });
      degree.set(file, (degree.get(file) ?? 0) + 1);
      degree.set(target.to, (degree.get(target.to) ?? 0) + 1);
      outbound.set(file, (outbound.get(file) ?? 0) + 1);
      inbound.set(target.to, (inbound.get(target.to) ?? 0) + 1);
    }
  }

  const sortedFiles = [...files].sort((a, b) => {
    const typeOrder = graphNodeType(a).localeCompare(graphNodeType(b));
    return typeOrder || a.localeCompare(b);
  });
  const maxDegree = Math.max(1, ...sortedFiles.map((file) => degree.get(file) ?? 0));
  const rings = assignRings(sortedFiles, edges, degree);

  const nodes = sortedFiles.map((file, index): WikiGraphNode => {
    const ring = rings.get(file) ?? 4;
    const { x, y } = radialPoint(index, sortedFiles.length, ring);
    const nodeDegree = degree.get(file) ?? 0;
    return {
      id: file,
      title: deps.humanTitle(file),
      type: graphNodeType(file),
      href: `/${file}`,
      preview: previews.get(file) || '(No readable content in this file.)',
      raw: rawContents.get(file) ?? '',
      html: htmlContents.get(file) ?? '',
      group: groups.get(file),
      degree: nodeDegree,
      x,
      y,
      r: Math.round(9 + (nodeDegree / maxDegree) * 20),
      ring,
      secondary: groups.get(file) ? `${groups.get(file)} · ${file}` : file,
      inbound: inbound.get(file) ?? 0,
      outbound: outbound.get(file) ?? 0,
    };
  });

  return { nodes, edges };
}

export function graphNodeType(relativePath: string): WikiGraphNodeType {
  if (relativePath.startsWith('raw/ingested/')) return 'raw-source';
  if (relativePath.startsWith('wiki/sources/')) return 'wiki-source';
  if (relativePath.startsWith('templates/')) return 'template';
  if (relativePath.startsWith('build-context/')) return 'build-context';
  if (relativePath.startsWith('deliverables/')) return 'deliverable';
  return 'wiki';
}

function rawUntrackedArchiveCandidate(value: string, deps: WikiGraphProjectionDeps): string | null {
  const clean = toPosix(deps.decodeHrefPath(value).replace(/^\/+/, '').replace(/#.*$/, ''));
  if (clean.startsWith('raw/untracked/')) {
    return `raw/ingested/${clean.slice('raw/untracked/'.length)}`;
  }
  if (clean.startsWith('wiki/raw/untracked/')) {
    return `raw/ingested/${clean.slice('wiki/raw/untracked/'.length)}`;
  }
  return null;
}

function graphTargetPath(value: string, currentDir: string, nodeIds: Set<string>, deps: WikiGraphProjectionDeps): string {
  const archivedRaw = rawUntrackedArchiveCandidate(value, deps);
  if (archivedRaw && nodeIds.has(archivedRaw)) return archivedRaw;
  const relative = deps.hrefToRelativePath(value, currentDir);
  const archivedRelative = rawUntrackedArchiveCandidate(relative, deps);
  if (archivedRelative && nodeIds.has(archivedRelative)) return archivedRelative;
  return relative;
}

function graphWikiTargetPath(
  value: string,
  currentDir: string,
  nodeIds: Set<string>,
  deps: WikiGraphProjectionDeps,
): string {
  const clean = value.trim();
  const candidates = [
    graphTargetPath(clean, currentDir, nodeIds, deps),
    clean.endsWith('.md') ? '' : graphTargetPath(`${clean}.md`, currentDir, nodeIds, deps),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (nodeIds.has(candidate)) return candidate;
  }

  if (!clean.includes('/')) {
    const canonical = canonicalizeName(clean);
    const matches = [...nodeIds].filter((nodeId) => {
      const basename = path.basename(nodeId, '.md');
      return (
        canonicalizeName(basename) === canonical ||
        canonicalizeName(deps.humanTitle(nodeId)) === canonical
      );
    });
    if (matches.length === 1) return matches[0];
  }

  return candidates[0] || graphTargetPath(clean, currentDir, nodeIds, deps);
}

function extractGraphTargets(
  markdown: string,
  currentDir: string,
  nodeIds: Set<string>,
  deps: WikiGraphProjectionDeps,
): Array<{ to: string; type: 'markdown' | 'citation' | 'wiki' }> {
  const targets: Array<{ to: string; type: 'markdown' | 'citation' | 'wiki' }> = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  const citationPattern = /\[src:\s*([^\]]+)\]/g;

  const add = (to: string, type: 'markdown' | 'citation' | 'wiki') => {
    const key = `${to}\0${type}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ to, type });
    }
  };

  for (const match of markdown.matchAll(markdownLinkPattern)) {
    const href = match[1]?.trim();
    if (href && href.endsWith('.md')) add(graphTargetPath(href, currentDir, nodeIds, deps), 'markdown');
  }

  for (const match of markdown.matchAll(citationPattern)) {
    const citationPath = match[1]?.trim();
    if (citationPath) add(graphTargetPath(citationPath, currentDir, nodeIds, deps), 'citation');
  }

  for (const wikiLink of extractWikiLinks(markdown)) {
    add(graphWikiTargetPath(wikiLink, currentDir, nodeIds, deps), 'wiki');
  }

  return targets;
}

function relationForTarget(
  from: string,
  to: string,
  targetType: 'markdown' | 'citation' | 'wiki',
): WikiGraphRelationType {
  if (targetType === 'citation') return 'cites';
  if (to.startsWith('templates/')) return 'uses_template';
  if (to.startsWith('build-context/')) return 'uses_context';
  if (to.startsWith('raw/ingested/')) return 'generated_from';
  if (from.startsWith('wiki/') && to.startsWith('deliverables/')) return 'produces';
  if (targetType === 'wiki') return 'related_to';
  return 'links_to';
}

function graphConceptGroup(relativePath: string, markdown: string): string | undefined {
  if (!relativePath.startsWith('wiki/concepts/')) return undefined;
  const parsed = matter(markdown);
  const group = parsed.data.group;
  if (typeof group === 'string' && group.trim()) return group.trim();
  return conceptGroupFromPath(relativePath);
}

function conceptGroupFromPath(relativePath: string): string | undefined {
  const parts = toPosix(relativePath).split('/');
  if (parts.length >= 4 && parts[0] === 'wiki' && parts[1] === 'concepts') return parts[2];
  return undefined;
}

function markdownPreview(markdown: string): string {
  const plain = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 900 ? `${plain.slice(0, 900)}...` : plain;
}

function assignRings(files: string[], edges: WikiGraphEdge[], degree: Map<string, number>): Map<string, number> {
  const rings = new Map<string, number>();
  const pageCandidates = files
    .filter((file) => graphNodeType(file) === 'wiki' || graphNodeType(file) === 'wiki-source')
    .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
  const center = pageCandidates[0] ?? files[0] ?? null;
  if (!center) return rings;
  rings.set(center, 0);

  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }

  const queue: Array<{ id: string; depth: number }> = [{ id: center, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth >= 2) continue;
    for (const next of neighbors.get(item.id) ?? []) {
      if (rings.has(next)) continue;
      rings.set(next, item.depth + 1);
      queue.push({ id: next, depth: item.depth + 1 });
    }
  }

  for (const file of files) {
    if (rings.has(file)) continue;
    const type = graphNodeType(file);
    rings.set(file, ['raw-source', 'template', 'build-context', 'deliverable'].includes(type) ? 3 : 4);
  }
  return rings;
}

function radialPoint(index: number, total: number, ring: number): { x: number; y: number } {
  const width = 1100;
  const height = 720;
  const cx = width / 2;
  const cy = height / 2;
  if (ring === 0) return { x: cx, y: cy };
  const angle = total > 1 ? (Math.PI * 2 * index) / total - Math.PI / 2 : 0;
  const radiusX = [0, 210, 330, 430, 500][ring] ?? 500;
  const radiusY = [0, 130, 210, 275, 320][ring] ?? 320;
  return {
    x: Math.round(cx + Math.cos(angle) * radiusX),
    y: Math.round(cy + Math.sin(angle) * radiusY),
  };
}
