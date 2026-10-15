import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { normalizeTags } from '../ingest/provenance.ts';
import { hashText } from '../utils/hash.ts';
import { extractSourceCitations, extractWikiLinks } from '../utils/markdown.ts';

/*
 The curation inventory: what a curation needs to choose what to read, without
 reading it. Metadata only — never a page body.

 Three things come out of it, and they are deliberately not the same kind of
 fact:
 - `signals` are DETERMINISTIC defects the engine can prove from the files
   (a broken reference, a missing or invalid `sources:`, a pivot whose tag no
   fiche carries any more). Each names who fixes it: a TAXO rebuild for a
   generated pivot, the curation for a fiche, a human for an editorial page.
 - `exactDuplicates` are pages whose normalized bodies are identical.
 - `candidates` (the `candidates` view) are groups of fiches sharing a tag or a
   cited source. Shared-source groups are retained only when the fiches span
   distinct roots under `wiki/sources/`. They are something to EXAMINE, never a
   finding: a shared tag or source proves no duplicate and these groups can be
   large, so each is split into reading batches of at most 25 paths.
 Content that became wrong on the merits is outside all three: only an
 editorial reading finds it.
*/

export const CANDIDATE_BATCH_SIZE = 25;
const SIGNAL_CAP = 200;
const EDITORIAL_CAP = 200;
const DUPLICATE_CAP = 100;

type PageKind = 'source' | 'concept';
type Owner = 'rebuild' | 'curation' | 'editorial';

export type InventoryPage = {
  path: string;
  kind: PageKind;
  title: string;
  tags: string[];
  citations: string[];
  links: string[];
  unresolvedWikiLinks: string[];
  sources: { declared: boolean; valid: boolean; paths: string[] };
  status: string | null;
  verified: boolean;
  generated: boolean;
  sheetCount: number | null;
  chars: number;
  bodyHash: string;
  hasBody: boolean;
  parseError: boolean;
};

export type InventorySignal = {
  path: string;
  signal: string;
  owner: Owner;
  detail?: string;
};

export type CandidateBatch = {
  reason: 'shared-tag' | 'shared-source';
  key: string;
  size: number;
  part: number;
  parts: number;
  paths: string[];
};

export type CurationInventoryInput = {
  view?: 'summary' | 'pages' | 'candidates';
  scope?: 'all' | 'sources' | 'concepts';
  cursor?: number;
  limit?: number;
};

type Deps = {
  rootDir: string;
  listWikiPagePaths: () => Promise<string[]>;
  resolvePath: (pagePath: string) => string;
};

function kindOf(pagePath: string): PageKind | null {
  if (pagePath.startsWith('wiki/sources/')) return 'source';
  if (pagePath.startsWith('wiki/concepts/')) return 'concept';
  return null;
}

// `sources:` is derived by the engine as a list of `{ path }` entries (a bare
// string is tolerated). Anything else — a scalar, an entry without a path, a
// path outside the workspace's proof folders — is invalid, and said so.
function readSources(data: Record<string, unknown>): InventoryPage['sources'] {
  if (!('sources' in data) || data.sources === null || data.sources === undefined) {
    return { declared: false, valid: false, paths: [] };
  }
  if (!Array.isArray(data.sources)) return { declared: true, valid: false, paths: [] };
  const paths: string[] = [];
  let valid = true;
  for (const entry of data.sources) {
    const value = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string'
        ? (entry as { path: string }).path
        : null;
    const clean = value?.trim().split('#')[0]?.trim();
    if (!clean || !/^(raw\/ingested|wiki)\//.test(clean) || clean.split('/').includes('..')) {
      valid = false;
      continue;
    }
    paths.push(clean);
  }
  return { declared: true, valid: valid && paths.length > 0, paths: [...new Set(paths)].sort() };
}

function isEditorial(page: InventoryPage): boolean {
  return page.status === 'stable' || page.verified;
}

function ownerOf(page: InventoryPage): Owner {
  if (isEditorial(page)) return 'editorial';
  if (page.kind === 'concept' && page.generated) return 'rebuild';
  return 'curation';
}

function workspaceTarget(href: string, pagePath: string): string | null {
  const clean = href.trim().split('#')[0]?.split('?')[0]?.trim() ?? '';
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || !clean.endsWith('.md')) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep literal */ }
  const joined = /^(wiki|raw)\//.test(decoded)
    ? path.posix.normalize(decoded)
    : path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), decoded));
  return joined.startsWith('..') ? null : joined;
}

export function createCurationInventory({ rootDir, listWikiPagePaths, resolvePath }: Deps) {
  const entry = async (pagePath: string, kind: PageKind): Promise<Omit<InventoryPage, 'unresolvedWikiLinks'> & { wikiLinks: string[] }> => {
    const raw = await readFile(resolvePath(pagePath), 'utf8');
    let parsed: ReturnType<typeof matter>;
    let parseError = false;
    try {
      parsed = matter(raw);
    } catch {
      parsed = { content: raw, data: {} } as ReturnType<typeof matter>;
      parseError = true;
    }
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const heading = /^#\s+(.+)$/m.exec(parsed.content)?.[1]?.trim();
    const title = typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : heading || path.basename(pagePath, '.md').replace(/[-_]+/g, ' ');
    // Tags come from the frontmatter, where TAXO writes them; a body
    // `Tags: #a #b` line is only a fallback.
    const bodyTags = (/^Tags:\s*(.+)$/im.exec(parsed.content)?.[1] ?? '')
      .split(/[\s,;|]+/).map((tag) => tag.replace(/^#/, '')).filter(Boolean);
    const tags = normalizeTags(Array.isArray(data.tags) || typeof data.tags === 'string' ? data.tags : bodyTags).sort();
    const normalizedBody = parsed.content.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
    const links = new Set<string>();
    for (const match of parsed.content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = workspaceTarget(match[1] ?? '', pagePath);
      if (target) links.add(target);
    }
    const sheetCount = Number(data.sheet_count);
    return {
      path: pagePath,
      kind,
      title,
      tags,
      citations: [...new Set(extractSourceCitations(raw))].sort(),
      links: [...links].sort(),
      wikiLinks: [...new Set(extractWikiLinks(parsed.content))],
      sources: readSources(data),
      status: typeof data.status === 'string' ? data.status : null,
      verified: Array.isArray(data.verified) ? data.verified.length > 0 : data.verified === true,
      generated: Boolean(data.generated),
      sheetCount: Number.isFinite(sheetCount) ? sheetCount : null,
      chars: parsed.content.trim().length,
      bodyHash: hashText(normalizedBody),
      hasBody: Boolean(normalizedBody),
      parseError,
    };
  };

  // Parsed once per state of wiki/sources + wiki/concepts (paths, sizes,
  // mtimes) and reused across the pages a caller walks through.
  let cache: { signature: string; pages: InventoryPage[]; unreadable: string[] } | null = null;
  const build = async () => {
    const paths = (await listWikiPagePaths()).filter((pagePath) => kindOf(pagePath) !== null);
    const stats = await Promise.all(paths.map((pagePath) =>
      stat(resolvePath(pagePath)).then((info) => `${pagePath}:${info.size}:${info.mtimeMs}`, () => `${pagePath}:missing`)));
    const signature = hashText(stats.join('\n'));
    if (cache?.signature === signature) return cache;
    const parsed: Array<Awaited<ReturnType<typeof entry>>> = [];
    const unreadable: string[] = [];
    for (let offset = 0; offset < paths.length; offset += 16) {
      const batch = paths.slice(offset, offset + 16);
      // A page pruned by a concurrent rebuild between listing and reading is
      // skipped and named, never the reason the whole inventory fails.
      const settled = await Promise.allSettled(batch.map((pagePath) => entry(pagePath, kindOf(pagePath) as PageKind)));
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') parsed.push(result.value);
        else unreadable.push(batch[index] ?? '');
      });
    }
    // A [[wiki link]] names a page by its file name, wherever it sits.
    const all = await listWikiPagePaths();
    const byName = new Map<string, string[]>();
    for (const pagePath of all) {
      const name = path.posix.basename(pagePath, '.md').normalize('NFKC').toLowerCase();
      byName.set(name, [...(byName.get(name) ?? []), pagePath]);
    }
    const pages = parsed.map(({ wikiLinks, ...page }) => {
      const links = new Set(page.links);
      const unresolved: string[] = [];
      for (const link of wikiLinks) {
        const name = path.posix.basename(link.replace(/\.md$/i, '')).normalize('NFKC').toLowerCase();
        const match = byName.get(name);
        if (match?.length) links.add(match[0] as string);
        else unresolved.push(link);
      }
      return { ...page, links: [...links].sort(), unresolvedWikiLinks: unresolved.sort() };
    });
    cache = { signature, pages, unreadable };
    return cache;
  };

  const exists = async (target: string, known: Set<string>) => {
    if (known.has(target)) return true;
    if (target.split('/').includes('..')) return false;
    try {
      await stat(path.join(rootDir, target));
      return true;
    } catch {
      return false;
    }
  };

  const signalsFor = async (pages: InventoryPage[]): Promise<InventorySignal[]> => {
    const known = new Set(pages.map((page) => page.path));
    const targets = new Set<string>();
    for (const page of pages) {
      for (const value of [...page.citations, ...page.links, ...page.sources.paths]) targets.add(value);
    }
    const present = new Map<string, boolean>();
    await Promise.all([...targets].map(async (target) => present.set(target, await exists(target, known))));
    const fichesByTag = new Map<string, number>();
    for (const page of pages) {
      if (page.kind !== 'source') continue;
      for (const tag of page.tags) fichesByTag.set(tag, (fichesByTag.get(tag) ?? 0) + 1);
    }
    const signals: InventorySignal[] = [];
    for (const page of pages) {
      const owner = ownerOf(page);
      const push = (signal: string, detail?: string) => signals.push({ path: page.path, signal, owner, ...(detail ? { detail } : {}) });
      if (page.parseError) push('parse-error', 'the frontmatter does not parse');
      const brokenCitations = page.citations.filter((target) => !present.get(target));
      if (brokenCitations.length) push('broken-citation', brokenCitations.join(', '));
      const brokenLinks = [...page.links.filter((target) => !present.get(target)), ...page.unresolvedWikiLinks.map((link) => `[[${link}]]`)];
      if (brokenLinks.length) push('broken-link', brokenLinks.join(', '));
      if (!page.sources.declared) push('missing-sources');
      else if (!page.sources.valid) push('invalid-sources', 'sources: must list workspace proof paths under raw/ingested/ or wiki/');
      const brokenSources = page.sources.paths.filter((target) => !present.get(target));
      if (brokenSources.length) push('broken-source-path', brokenSources.join(', '));
      if (page.status === 'deprecated') push('deprecated');
      // Obsolescence signals readable in the metadata. They say a pivot is
      // probably out of step with the fiches; a rebuild regenerates it.
      if (page.kind === 'concept') {
        const ficheCitations = page.citations.filter((target) => target.startsWith('wiki/sources/') && present.get(target));
        if (ficheCitations.length === 0) push('pivot-without-fiche-citation');
        if (page.tags.length > 0 && page.tags.every((tag) => !fichesByTag.has(tag))) {
          push('pivot-tag-not-carried', `no fiche carries ${page.tags.join(', ')} any more`);
        }
        if (page.sheetCount !== null && page.sheetCount !== ficheCitations.length) {
          push('pivot-sheet-count-mismatch', `sheet_count ${page.sheetCount}, ${ficheCitations.length} existing fiche citation(s)`);
        }
      }
    }
    return signals;
  };

  const duplicatesOf = (pages: InventoryPage[]) => {
    const groups = new Map<string, string[]>();
    for (const page of pages) {
      if (!page.hasBody) continue;
      groups.set(page.bodyHash, [...(groups.get(page.bodyHash) ?? []), page.path]);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  };

  // Fiches only: a pivot is regenerated from its fiches, so comparing pivots
  // to each other compares the rebuild with itself.
  const candidatesOf = (pages: InventoryPage[]): CandidateBatch[] => {
    const groups = new Map<string, { reason: CandidateBatch['reason']; key: string; paths: Set<string> }>();
    const sourceRootOf = (pagePath: string) => {
      const prefix = 'wiki/sources/';
      if (!pagePath.startsWith(prefix)) return null;
      return pagePath.slice(prefix.length).split('/')[0] || null;
    };
    const add = (reason: CandidateBatch['reason'], key: string, pagePath: string) => {
      const id = `${reason}\0${key}`;
      const group = groups.get(id) ?? { reason, key, paths: new Set<string>() };
      group.paths.add(pagePath);
      groups.set(id, group);
    };
    for (const page of pages) {
      if (page.kind !== 'source') continue;
      for (const tag of page.tags) add('shared-tag', tag, page.path);
      for (const source of new Set([...page.sources.paths, ...page.citations].filter((value) => value.startsWith('raw/')))) {
        add('shared-source', source, page.path);
      }
    }
    const sorted = [...groups.values()]
      .filter((group) => {
        if (group.paths.size <= 1) return false;
        if (group.reason !== 'shared-source') return true;
        const roots = new Set([...group.paths].map(sourceRootOf).filter((root): root is string => root !== null));
        return roots.size > 1;
      })
      // The narrowest groups first: they are where a real overlap is most
      // likely and cheapest to check.
      .sort((a, b) => a.paths.size - b.paths.size || a.reason.localeCompare(b.reason) || a.key.localeCompare(b.key));
    const batches: CandidateBatch[] = [];
    for (const group of sorted) {
      const paths = [...group.paths].sort();
      const parts = Math.ceil(paths.length / CANDIDATE_BATCH_SIZE);
      for (let part = 0; part < parts; part += 1) {
        batches.push({
          reason: group.reason,
          key: group.key,
          size: paths.length,
          part: part + 1,
          parts,
          paths: paths.slice(part * CANDIDATE_BATCH_SIZE, (part + 1) * CANDIDATE_BATCH_SIZE),
        });
      }
    }
    return batches;
  };

  return async function curationInventory({ view = 'summary', scope = 'all', cursor = 0, limit }: CurationInventoryInput = {}) {
    const { pages, unreadable } = await build();
    const start = Math.max(0, Math.floor(cursor));
    if (view === 'candidates') {
      const batches = candidatesOf(pages);
      const size = Math.max(1, Math.min(100, Math.floor(limit ?? 20)));
      const selected = batches.slice(start, start + size);
      return {
        view: 'candidates',
        note: 'Candidates to examine, not findings: shared-source groups span distinct wiki/sources roots, and a shared tag or source never proves a duplicate. Read a batch with wiki_read_pages (at most 25 paths) before concluding anything.',
        total: batches.length,
        cursor: start,
        nextCursor: start + selected.length < batches.length ? start + selected.length : null,
        batches: selected,
      };
    }
    if (view === 'pages') {
      const scoped = pages.filter((page) => scope === 'all' || (scope === 'sources' ? page.kind === 'source' : page.kind === 'concept'));
      const size = Math.max(1, Math.min(500, Math.floor(limit ?? 100)));
      const selected = scoped.slice(start, start + size);
      return {
        view: 'pages',
        scope,
        total: scoped.length,
        cursor: start,
        nextCursor: start + selected.length < scoped.length ? start + selected.length : null,
        ...(unreadable.length ? { unreadable } : {}),
        pages: selected.map((page) => ({
          path: page.path,
          kind: page.kind,
          title: page.title,
          tags: page.tags,
          ...(page.status ? { status: page.status } : {}),
          ...(page.verified ? { verified: true } : {}),
          ...(page.kind === 'concept' && page.generated ? { generated: true } : {}),
          // Paths repeat across pages and dominate the payload: an entry
          // carries its proofs and counts; a broken reference is named by the
          // summary's signals, and wiki_read_pages lists citations and links.
          sources: page.sources.paths,
          ...(page.citations.some((target) => !page.sources.paths.includes(target)) ? { citationCount: page.citations.length } : {}),
          ...(page.links.length ? { linkCount: page.links.length } : {}),
          chars: page.chars,
          ...(page.parseError ? { parseError: true } : {}),
        })),
      };
    }
    // The summary: what the engine can prove, in one bounded answer.
    const signals = await signalsFor(pages);
    const duplicates = duplicatesOf(pages);
    const editorial = pages.filter(isEditorial).map((page) => page.path);
    const byOwner = (owner: Owner) => signals.filter((signal) => signal.owner === owner).length;
    return {
      view: 'summary',
      counts: {
        sources: pages.filter((page) => page.kind === 'source').length,
        concepts: pages.filter((page) => page.kind === 'concept').length,
        editorial: editorial.length,
        signals: signals.length,
        signalsByOwner: { rebuild: byOwner('rebuild'), curation: byOwner('curation'), editorial: byOwner('editorial') },
        candidateBatches: candidatesOf(pages).length,
      },
      signals: signals.slice(0, SIGNAL_CAP),
      ...(signals.length > SIGNAL_CAP ? { signalsOmitted: signals.length - SIGNAL_CAP } : {}),
      exactDuplicateGroupCount: duplicates.length,
      exactDuplicates: duplicates.slice(0, DUPLICATE_CAP),
      // Stable or verified pages: human-reviewed text, examined on its own
      // and never fixed by a rebuild.
      editorialPages: editorial.slice(0, EDITORIAL_CAP),
      ...(unreadable.length ? { unreadable } : {}),
    };
  };
}
