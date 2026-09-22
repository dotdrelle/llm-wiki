import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  extractSourceCitationsWithAnchors,
  normalizeHeadingPathKey,
  splitMarkdownSections,
} from '../utils/markdown.ts';
import { deriveTerminalSources } from './derive.ts';

/*
 * Lot 0 of `plan-provenance-feuilles.md`: a READ-ONLY audit of the corpus, not
 * a pipeline. It never writes, never calls the LLM and never applies an
 * operation. It measures the provenance defects the plan exists to fix:
 * undeclared citations, declared-but-unrepresented sources, unanchored or
 * ambiguous anchors, and the mono-source-with-a-repeated-citation shape.
 *
 * It reuses the existing parsers (`splitMarkdownSections`,
 * `extractSourceCitationsWithAnchors`, `normalizeHeadingPathKey`) so the audit
 * and the future resolver cannot drift into two different readings of a page.
 */

export interface AuditCitation {
  path: string;
  anchor: string | null;
}

export interface PageAudit {
  /** Workspace-relative POSIX path. */
  path: string;
  subject: string | null;
  sectionCount: number;
  citations: AuditCitation[];
  anchored: number;
  unanchored: number;
  anchorResolved: number;
  anchorAmbiguous: number;
  anchorUnresolved: number;
  /** Paths declared in the frontmatter `sources:` inventory. */
  declaredSources: string[];
  /** Declared paths that at least one body citation reaches. */
  representedSources: string[];
  /** Declared paths NO body citation reaches (phantom sources). */
  unrepresentedSources: string[];
  /** Cited paths absent from the declared inventory. */
  citedNotDeclared: string[];
  /** Distinct cited paths (0 when the page cites nothing). */
  distinctCitedSources: number;
  /** True when the same path is cited by EVERY section of a multi-section page. */
  repeatsOneCitationEverywhere: boolean;
}

export interface SourcePageAudit extends PageAudit {
  hasSummaryHeading: boolean;
  /** Coarse structural fingerprint, to count distinct source-page formats. */
  structureSignature: string;
}

export interface LeafAudit extends PageAudit {
  concept: string;
  monoSource: boolean;
}

export interface ChainAudit {
  /** Longest citation path from a wiki page to another wiki page. */
  maxDepth: number;
  /** Wiki-page citation cycles (each cycle listed once, sorted). */
  cycles: string[][];
}

export interface WorkspaceProvenanceAudit {
  workspace: string;
  generatedAt: string;
  sourcePages: SourcePageAudit[];
  leaves: LeafAudit[];
  chain: ChainAudit;
  summary: {
    sourcePageCount: number;
    leafCount: number;
    sourcePageDistinctFormats: number;
    sourcePagesWithNoCitation: number;
    anchoredCitations: number;
    unanchoredCitations: number;
    anchorAmbiguous: number;
    anchorUnresolved: number;
    leavesWithUnrepresentedSources: number;
    phantomSourceEntries: number;
    /**
     * A leaf citing its ONE source in every section. It is a mono-source
     * property, NOT a defect: a leaf drawing from a single document is right to
     * cite it per section. The real defect (declaring several sources, reaching
     * one) is `phantomSourceEntries`.
     */
    monoSourceRepeats: number;
    monoSourceLeaves: number;
    multiSourceLeaves: number;
    /** Citations without an anchor: each implies a whole-file read at export. */
    wholeFileReadsImplied: number;
  };
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
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
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(toPosix(path.relative(rootDir, absolute)));
      }
    }
  };
  await walk(rootDir);
  return out.sort();
}

function declaredSourcePaths(data: Record<string, unknown>): string[] {
  const raw = data?.sources;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        return (entry as { path: string }).path;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\\/g, '/'));
}

interface RawSectionIndex {
  fullPaths: Map<string, number>;
  headingTexts: Map<string, number>;
}

async function loadRawIndex(rootDir: string, rawPath: string, cache: Map<string, RawSectionIndex | null>): Promise<RawSectionIndex | null> {
  if (cache.has(rawPath)) return cache.get(rawPath) ?? null;
  const absolute = path.join(rootDir, rawPath);
  if (!existsSync(absolute)) {
    cache.set(rawPath, null);
    return null;
  }
  let content: string;
  try {
    content = await readFile(absolute, 'utf8');
  } catch {
    cache.set(rawPath, null);
    return null;
  }
  const { sections } = splitMarkdownSections(content);
  const fullPaths = new Map<string, number>();
  const headingTexts = new Map<string, number>();
  for (const section of sections) {
    if (!section.headingText) continue;
    const full = normalizeHeadingPathKey(section.headingPath);
    fullPaths.set(full, (fullPaths.get(full) ?? 0) + 1);
    const text = normalizeHeadingPathKey([section.headingText]);
    headingTexts.set(text, (headingTexts.get(text) ?? 0) + 1);
  }
  const index: RawSectionIndex = { fullPaths, headingTexts };
  cache.set(rawPath, index);
  return index;
}

function classifyAnchor(
  index: RawSectionIndex | null,
  anchor: string | null,
): 'resolved' | 'ambiguous' | 'unresolved' | 'none' {
  if (!anchor) return 'none';
  if (!index) return 'unresolved';
  const parts = anchor.split('>').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return 'unresolved';
  if (parts.length === 1) {
    const key = normalizeHeadingPathKey(parts);
    const count = index.headingTexts.get(key) ?? 0;
    if (count === 1) return 'resolved';
    if (count > 1) return 'ambiguous';
    return 'unresolved';
  }
  const key = normalizeHeadingPathKey(parts);
  return (index.fullPaths.get(key) ?? 0) > 0 ? 'resolved' : 'unresolved';
}

interface PageParse {
  data: Record<string, unknown>;
  content: string;
  sections: ReturnType<typeof splitMarkdownSections>['sections'];
  citations: AuditCitation[];
}

async function parsePage(rootDir: string, relPath: string, rawCache: Map<string, RawSectionIndex | null>): Promise<PageParse> {
  const content = await readFile(path.join(rootDir, relPath), 'utf8');
  const parsed = matter(content);
  const { sections } = splitMarkdownSections(content);
  const citations: AuditCitation[] = [];
  for (const section of sections) {
    for (const citation of extractSourceCitationsWithAnchors(section.markdown)) {
      citations.push({ path: citation.path.replace(/\\/g, '/'), anchor: citation.anchor });
    }
  }
  // A page with no section heading still holds a preamble citation.
  if (sections.length === 0) {
    for (const citation of extractSourceCitationsWithAnchors(content)) {
      citations.push({ path: citation.path.replace(/\\/g, '/'), anchor: citation.anchor });
    }
  }
  // Warm the raw index once per cited archive (used for anchor classification).
  for (const citation of citations) {
    if (citation.anchor) await loadRawIndex(rootDir, citation.path, rawCache);
  }
  return { data: (parsed.data ?? {}) as Record<string, unknown>, content, sections, citations };
}

function pageAuditCommon(
  relPath: string,
  parse: PageParse,
  rawCache: Map<string, RawSectionIndex | null>,
  resolvePage: (pagePath: string) => string | null,
): PageAudit {
  const citations = parse.citations;
  const declared = declaredSourcePaths(parse.data);
  const declaredSet = new Set(declared);
  const citedSet = new Set(citations.map((entry) => entry.path));
  // The proof a page reaches is the TERMINAL closure, not its direct citations:
  // a two-level leaf cites its source note, which cites the archive. Comparing
  // `sources:` to the direct citations would report every correct leaf as a
  // phantom and every source note as undeclared.
  const terminalSet = new Set(
    deriveTerminalSources({ content: parse.content, resolvePage }).terminal,
  );

  let anchored = 0;
  let unanchored = 0;
  let anchorResolved = 0;
  let anchorAmbiguous = 0;
  let anchorUnresolved = 0;
  for (const citation of citations) {
    if (!citation.anchor) {
      unanchored += 1;
      continue;
    }
    anchored += 1;
    const verdict = classifyAnchor(rawCache.get(citation.path) ?? null, citation.anchor);
    if (verdict === 'resolved') anchorResolved += 1;
    else if (verdict === 'ambiguous') anchorAmbiguous += 1;
    else anchorUnresolved += 1;
  }

  // A citation repeated in EVERY cited section of a multi-section page is the
  // shape that carried no information (one source, same path after each `##`).
  // Sections that cite nothing (a bare title) are ignored, not treated as a
  // missing citation.
  let repeatsOneCitationEverywhere = false;
  const citedSections = parse.sections
    .map((section) => new Set(
      extractSourceCitationsWithAnchors(section.markdown).map((entry) => entry.path.replace(/\\/g, '/')),
    ))
    .filter((paths) => paths.size > 0);
  if (citedSections.length >= 2) {
    const first = citedSections[0];
    repeatsOneCitationEverywhere = first.size === 1
      && citedSections.every((paths) => paths.size === 1 && paths.has([...first][0]));
  }

  const subject = typeof parse.data.subject === 'string' ? parse.data.subject : null;

  return {
    path: relPath,
    subject,
    sectionCount: parse.sections.length,
    citations,
    anchored,
    unanchored,
    anchorResolved,
    anchorAmbiguous,
    anchorUnresolved,
    declaredSources: declared,
    representedSources: [...declaredSet].filter((entry) => terminalSet.has(entry)),
    unrepresentedSources: [...declaredSet].filter((entry) => !terminalSet.has(entry)),
    citedNotDeclared: [...terminalSet].filter((entry) => !declaredSet.has(entry)),
    distinctCitedSources: citedSet.size,
    repeatsOneCitationEverywhere,
  };
}

function structureSignature(parse: PageParse): string {
  const levels = parse.sections.map((section) => section.headingLevel).sort((a, b) => a - b);
  const hasSummary = parse.sections.some((section) => /^r[ée]sum[ée]$/i.test(section.headingText.trim()));
  const cites = parse.citations.length > 0 ? 'cited' : 'uncited';
  return `h:${levels.join(',') || 'none'}|summary:${hasSummary ? 'y' : 'n'}|${cites}`;
}

function updateChain(
  pages: Map<string, string[]>,
  knownPaths: Set<string>,
  relPath: string,
  citations: AuditCitation[],
): void {
  const targets = citations
    .map((citation) => citation.path)
    .filter((target) => knownPaths.has(target));
  pages.set(relPath, [...new Set(targets)]);
}

function findCycles(pages: Map<string, string[]>): string[][] {
  const cycles = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    const color = state.get(node) ?? 0;
    if (color === 1) {
      const start = stack.indexOf(node);
      if (start >= 0) {
        const cycle = stack.slice(start);
        // Canonical form: rotate so the smallest node leads, so the same cycle
        // reached from another entry point is reported once.
        const minIndex = cycle.reduce((best, value, index) => (value < cycle[best] ? index : best), 0);
        const rotated = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
        cycles.add(rotated.join(' -> '));
      }
      return;
    }
    if (color === 2) return;
    state.set(node, 1);
    stack.push(node);
    for (const next of pages.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, 2);
  };
  for (const node of pages.keys()) visit(node);
  return [...cycles].sort().map((key) => key.split(' -> '));
}

function chainDepth(pages: Map<string, string[]>): number {
  const memo = new Map<string, number>();
  const depth = (node: string, seen: Set<string>): number => {
    if (memo.has(node)) return memo.get(node) ?? 0;
    if (seen.has(node)) return 0;
    seen.add(node);
    let best = 0;
    for (const next of pages.get(node) ?? []) {
      best = Math.max(best, 1 + depth(next, seen));
    }
    memo.set(node, best);
    return best;
  };
  let max = 0;
  for (const node of pages.keys()) max = Math.max(max, depth(node, new Set()));
  return max;
}

export async function auditWorkspace(options: { rootDir: string; workspace?: string }): Promise<WorkspaceProvenanceAudit> {
  const rootDir = path.resolve(options.rootDir);
  const rawCache = new Map<string, RawSectionIndex | null>();
  const wikiDir = path.join(rootDir, 'wiki');
  const allWikiFiles = (await listMarkdownFiles(wikiDir)).map((rel) => toPosix(path.join('wiki', rel)));

  const sourcePages: SourcePageAudit[] = [];
  const leaves: LeafAudit[] = [];
  const chainPages = new Map<string, string[]>();

  const parsedPages: Array<{ relPath: string; isSource: boolean; parse: PageParse }> = [];
  for (const relPath of allWikiFiles) {
    const isSource = /^wiki\/sources\/[^/]+\.md$/.test(relPath);
    const isLeaf = relPath.startsWith('wiki/concepts/') && relPath.endsWith('.md');
    if (!isSource && !isLeaf) continue;
    let parse: PageParse;
    try {
      parse = await parsePage(rootDir, relPath, rawCache);
    } catch {
      continue; // An unreadable page is skipped, never fatal.
    }
    parsedPages.push({ relPath, isSource, parse });
  }

  // Two passes: every page path must be known before edges are resolved, or a
  // citation to a page read later in the walk is dropped and a cycle vanishes.
  const knownPaths = new Set(parsedPages.map((page) => page.relPath));
  // Resolve a cited wiki page from the already-parsed content, never by a second
  // disk read: the closure and the audit must read the same bytes.
  const pageContents = new Map(parsedPages.map((page) => [page.relPath, page.parse.content]));
  const resolvePage = (pagePath: string): string | null => {
    const known = pageContents.get(pagePath);
    if (known != null) return known;
    try {
      const absolute = path.join(rootDir, pagePath);
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    } catch {
      return null;
    }
  };
  for (const { relPath, isSource, parse } of parsedPages) {
    const common = pageAuditCommon(relPath, parse, rawCache, resolvePage);
    updateChain(chainPages, knownPaths, relPath, parse.citations);
    if (isSource) {
      sourcePages.push({
        ...common,
        hasSummaryHeading: parse.sections.some((section) => /^r[ée]sum[ée]$/i.test(section.headingText.trim())),
        structureSignature: structureSignature(parse),
      });
    } else {
      const concept = relPath.split('/')[2] ?? 'unclassified';
      leaves.push({ ...common, concept, monoSource: common.distinctCitedSources <= 1 });
    }
  }

  const distinctFormats = new Set(sourcePages.map((page) => page.structureSignature)).size;
  const phantomSourceEntries = leaves.reduce((sum, leaf) => sum + leaf.unrepresentedSources.length, 0);

  return {
    workspace: options.workspace ?? path.basename(rootDir),
    generatedAt: new Date().toISOString(),
    sourcePages: sourcePages.sort((a, b) => a.path.localeCompare(b.path)),
    leaves: leaves.sort((a, b) => a.path.localeCompare(b.path)),
    chain: { maxDepth: chainDepth(chainPages), cycles: findCycles(chainPages) },
    summary: {
      sourcePageCount: sourcePages.length,
      leafCount: leaves.length,
      sourcePageDistinctFormats: distinctFormats,
      sourcePagesWithNoCitation: sourcePages.filter((page) => page.citations.length === 0).length,
      anchoredCitations: sourcePages.reduce((sum, page) => sum + page.anchored, 0)
        + leaves.reduce((sum, page) => sum + page.anchored, 0),
      unanchoredCitations: sourcePages.reduce((sum, page) => sum + page.unanchored, 0)
        + leaves.reduce((sum, page) => sum + page.unanchored, 0),
      anchorAmbiguous: sourcePages.reduce((sum, page) => sum + page.anchorAmbiguous, 0)
        + leaves.reduce((sum, page) => sum + page.anchorAmbiguous, 0),
      anchorUnresolved: sourcePages.reduce((sum, page) => sum + page.anchorUnresolved, 0)
        + leaves.reduce((sum, page) => sum + page.anchorUnresolved, 0),
      leavesWithUnrepresentedSources: leaves.filter((leaf) => leaf.unrepresentedSources.length > 0).length,
      phantomSourceEntries,
      monoSourceRepeats: leaves.filter((leaf) => leaf.repeatsOneCitationEverywhere).length,
      monoSourceLeaves: leaves.filter((leaf) => leaf.monoSource).length,
      multiSourceLeaves: leaves.filter((leaf) => !leaf.monoSource).length,
      wholeFileReadsImplied: sourcePages.reduce((sum, page) => sum + page.unanchored, 0)
        + leaves.reduce((sum, page) => sum + page.unanchored, 0),
    },
  };
}
