import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import { resolveAnchor } from '../provenance/locators.ts';
import {
  extractSourceCitations,
  extractSourceCitationsWithAnchors,
  extractWikiLinks,
  splitCitationAnchor,
} from '../utils/markdown.ts';
import type { WorkspaceService } from './workspaceService.ts';

/**
 * One reading contract, owned by the engine.
 *
 * A reference is `path` or `path#anchor`. The manager never resolves an anchor
 * itself: it asks this module (through the MCP tool) and receives a status. A
 * status is data, never a conclusion — `anchor-missing` means "read the whole
 * document or try another heading", not "the claim is false".
 */
export const MAX_READ_PAGES = 25;

export type ReadStatus =
  | 'read'
  | 'partial'
  | 'missing'
  | 'unreadable'
  | 'anchor-missing'
  | 'anchor-ambiguous'
  | 'over-budget';

export type AnchorStatus = 'resolved' | 'ambiguous' | 'missing' | null;

export interface ReadWikiPagePayload {
  /** The requested reference, anchor included. Stable identity for a ledger. */
  ref: string;
  /** Backward-compatible alias of `ref` for callers that only know `path`. */
  path: string;
  /** The file path, without the anchor. */
  filePath: string;
  anchor: string | null;
  anchorStatus: AnchorStatus;
  status: ReadStatus;
  found: boolean;
  allowed: boolean;
  truncated: boolean;
  content: string;
  alternatives?: string[];
  citations?: string[];
  citationRefs?: Array<{ path: string; anchor: string | null }>;
  links?: string[];
  error?: string;
}

/**
 * Resolve a path under the readable workspace roots. Kept here (and re-exported
 * by mcpServer) so the read contract and the boundary check live together.
 */
export function resolveReadableWorkspacePath(
  workspace: WorkspaceService,
  requestedPath: string,
): string {
  let decodedPath = requestedPath.trim();
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Keep malformed percent sequences literal; the allow-list and workspace
    // boundary checks below remain authoritative.
  }
  const normalizedPath = decodedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  // Models reconstruct full paths from the status output (absolute workspace
  // path + relative file) or pass manager-style `workspaces/<name>/…`
  // prefixes. Both mean the same file the user selected: relativize them
  // instead of answering "Access denied" on a path that points at the right
  // place. The allow-list check below stays authoritative either way.
  let candidatePath = normalizedPath;
  if (path.isAbsolute(normalizedPath)) {
    const relativeToRoot = path.relative(
      workspace.paths.rootDir,
      path.normalize(normalizedPath),
    );
    if (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
      candidatePath = relativeToRoot;
    }
  } else {
    const managerPrefix = /^workspaces\/[^/]+\/(.+)$/.exec(normalizedPath);
    if (managerPrefix) candidatePath = managerPrefix[1];
  }
  const absolutePath = resolveInside(workspace.paths.rootDir, candidatePath);
  const relativeToRoot = path.relative(workspace.paths.rootDir, absolutePath);
  const relativeToWiki = path.relative(workspace.paths.wikiDir, absolutePath);
  const relativeToIngested = path.relative(workspace.paths.rawIngestedDir, absolutePath);
  const relativeToUntracked = path.relative(workspace.paths.rawUntrackedDir, absolutePath);
  const relativeToDeliverables = path.relative(workspace.paths.deliverablesDir, absolutePath);
  const underRoot = !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot);
  const underWiki = !relativeToWiki.startsWith('..') && !path.isAbsolute(relativeToWiki);
  const underIngested =
    !relativeToIngested.startsWith('..') && !path.isAbsolute(relativeToIngested);
  const underUntracked =
    !relativeToUntracked.startsWith('..') && !path.isAbsolute(relativeToUntracked);
  const underDeliverables =
    !relativeToDeliverables.startsWith('..') && !path.isAbsolute(relativeToDeliverables);

  if (!underRoot || (!underWiki && !underIngested && !underUntracked && !underDeliverables)) {
    const suggestion = relativeToRoot.startsWith('templates/')
      ? ' Use template_read for templates/.'
      : relativeToRoot.startsWith('deliverables/')
        ? ' Deliverables are generated: read the template that produces it with template_read, or the wiki pages it cites.'
        : relativeToRoot.startsWith('build-context/')
          ? ' build-context/ is applied at build time, not read here; template_read reports which files a template resolves.'
          : '';
    throw new Error(
      `Access denied: path must be under wiki/, raw/ingested/, raw/untracked/, or deliverables/.${suggestion}`,
    );
  }

  return absolutePath;
}

export async function readWorkspaceWikiPage(
  workspace: WorkspaceService,
  pagePath: string,
  options?: { maxPageChars?: number },
): Promise<ReadWikiPagePayload> {
  const { path: filePath, anchor } = splitCitationAnchor(pagePath);
  const ref = String(pagePath ?? '').trim();
  try {
    const absolutePath = resolveReadableWorkspacePath(workspace, filePath);
    if (!(await pathExists(absolutePath))) {
      return {
        ref,
        path: ref,
        filePath,
        anchor,
        anchorStatus: null,
        status: 'missing',
        found: false,
        allowed: true,
        truncated: false,
        content: '',
        error: `Page not found: ${filePath}`,
      };
    }

    const fullContent = await readFile(absolutePath, 'utf8');
    let content = fullContent;
    let anchorStatus: AnchorStatus = null;
    let alternatives: string[] | undefined;
    if (anchor) {
      const resolution = resolveAnchor(fullContent, anchor);
      anchorStatus = resolution.status;
      if (resolution.status === 'resolved') {
        content = resolution.text;
      } else {
        // Never widen silently: an unresolved anchor returns no content, and
        // the caller explicitly decides to read the whole file or try an
        // alternative heading.
        content = '';
        if (resolution.status === 'ambiguous') {
          alternatives = resolution.matches.map((headingPath) => headingPath.join(' > '));
        }
      }
    }

    const maxPageChars = options?.maxPageChars;
    const truncated =
      typeof maxPageChars === 'number' &&
      maxPageChars > 0 &&
      content.length > maxPageChars;
    const status: ReadStatus = truncated
      ? 'partial'
      : anchorStatus === 'ambiguous'
        ? 'anchor-ambiguous'
        : anchorStatus === 'missing'
          ? 'anchor-missing'
          : 'read';
    return {
      ref,
      path: ref,
      filePath,
      anchor,
      anchorStatus,
      status,
      found: true,
      allowed: true,
      truncated,
      content: truncated
        ? `${content.slice(0, maxPageChars).trimEnd()}\n[truncated]`
        : content,
      ...(alternatives ? { alternatives } : {}),
      citations: [...new Set(extractSourceCitations(content))],
      citationRefs: [...extractSourceCitationsWithAnchors(content)],
      links: [...new Set(extractWikiLinks(content))],
    };
  } catch (error) {
    return {
      ref,
      path: ref,
      filePath,
      anchor,
      anchorStatus: null,
      status: 'unreadable',
      found: false,
      allowed: false,
      truncated: false,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function overBudgetPage(ref: string): ReadWikiPagePayload {
  const { path: filePath, anchor } = splitCitationAnchor(ref);
  return {
    ref,
    path: ref,
    filePath,
    anchor,
    anchorStatus: null,
    status: 'over-budget',
    found: true,
    allowed: true,
    truncated: false,
    content: '',
    error: 'Budget exhausted before this reference was read.',
  };
}

export interface ReadWikiPagesPayload {
  schemaVersion: 1;
  pages: ReadWikiPagePayload[];
  coverage: {
    requested: number;
    read: number;
    partial: number;
    missing: number;
    unreadable: number;
    anchorMissing: number;
    anchorAmbiguous: number;
    overBudget: number;
    covered: number;
    incomplete: boolean;
    charsUsed: number;
    charBudget: number | null;
  };
}

/**
 * Read a bounded batch in request order. The total budget is enforced here so
 * every caller gets the same ledger, and a page that does not fit is reported
 * as `over-budget` instead of disappearing.
 */
export async function readWikiPagesPayload(
  workspace: WorkspaceService,
  paths: string[],
  options?: { maxPageChars?: number; maxTotalChars?: number },
): Promise<ReadWikiPagesPayload> {
  const requested = [...new Set((paths ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))];
  const configuredBudget = Number(options?.maxTotalChars);
  const budget = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : Infinity;
  let remaining = budget;
  const pages: ReadWikiPagePayload[] = [];
  for (const ref of requested.slice(0, MAX_READ_PAGES)) {
    if (remaining <= 0) {
      pages.push(overBudgetPage(ref));
      continue;
    }
    const perPageCap = Math.min(
      options?.maxPageChars ?? remaining,
      remaining,
    );
    pages.push(await readWorkspaceWikiPage(workspace, ref, { maxPageChars: perPageCap }));
    const contentLength = pages.at(-1)?.content.length ?? 0;
    remaining = Math.max(0, remaining - contentLength);
  }
  const count = (status: ReadStatus) => pages.filter((page) => page.status === status).length;
  const covered = count('read') + count('partial');
  return {
    schemaVersion: 1,
    pages,
    coverage: {
      requested: requested.length,
      read: count('read'),
      partial: count('partial'),
      missing: count('missing'),
      unreadable: count('unreadable'),
      anchorMissing: count('anchor-missing'),
      anchorAmbiguous: count('anchor-ambiguous'),
      overBudget: count('over-budget'),
      covered,
      incomplete: covered < requested.length,
      charsUsed: budget === Infinity
        ? pages.reduce((sum, page) => sum + page.content.length, 0)
        : Math.min(budget, budget - remaining),
      charBudget: budget === Infinity ? null : budget,
    },
  };
}
