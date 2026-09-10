import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import matter from 'gray-matter';
import { WorkspaceService } from './workspaceService.ts';
import { RetrievalService } from './retrievalService.ts';
import { HistoryService, commitHistorySafely } from './historyService.ts';
import { checkProductionIdle } from './productionLocks.ts';
import { loadWikiGraphSnapshot, summarizeWikiGraph } from '../graph/wiki/overview.ts';
import { pathExists } from '../utils/fs.ts';
import { resolveInside, relativeFrom } from '../utils/path.ts';
import { extractSourceCitations, extractWikiLinks, parseTemplateInstructions } from '../utils/markdown.ts';
import {
  buildQueryGraph,
  graphNeighbors,
  graphNodesByConcept,
  graphNodesByTag,
  graphShortestPath,
} from '../graph/wiki/queryGraph.ts';import { hashText } from '../utils/hash.ts';
import { listHelpChapters, readHelpChapter, searchHelpChapters } from '../utils/helpDoc.ts';
import type { AppConfig } from '../types.ts';

const LLM_WIKI_VERSION = '0.15.92';
const MAX_SOURCE_NAME_CHARS = 200;
const MAX_SOURCE_SUBDIR_CHARS = 300;
const MAX_SOURCE_CONTENT_CHARS = 1_000_000;

/**
 * Lines of a template body that are prose outside an instruction block.
 *
 * A template is a generation spec, not a document: its body must contain only
 * headings and multiline `[[INSTRUCTION: ...]]` blocks (which carry the
 * `[src: ...]` citations). Prewritten prose written next to the instructions
 * is copied verbatim into the deliverable on build and can never be refreshed
 * from the wiki, so it is rejected rather than persisted.
 */
export function templateHardContentViolations(content: string): string[] {
  const parsed = matter(content);
  const withoutInstructions = parsed.content.replace(/\[\[INSTRUCTION:\s*[\s\S]*?\]\]/g, '');
  const violations: string[] = [];
  let insideUnclosed = false;
  let skippedAfterUnclosed = 0;
  for (const line of withoutInstructions.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s+\S/.test(trimmed)) continue;
    if (/^([-*_])\1{2,}$/.test(trimmed)) continue;
    // Everything after an unterminated opener is INSIDE that block, so it is
    // not prose and must not be reported as such. But stopping silently made
    // the refusal claim to list the offending lines while checking none of
    // them: the author fixes the closer, resubmits, and only then discovers the
    // rest. Skip them — and say the check stopped.
    if (insideUnclosed) {
      skippedAfterUnclosed += 1;
      continue;
    }
    if (trimmed === ']]') {
      violations.push(
        "a ']]' line outside any instruction block: delete it or merge it into " +
          'the block above — an instruction block is one [[INSTRUCTION: ... ]] pair',
      );
      continue;
    }
    // Not anchored: an opener after prose on the same line ("Intro. [[INSTRUCTION:")
    // left insideUnclosed false, and the block's own body was then reported
    // line by line as prose — the exact leak this detector exists to prevent,
    // just moved to a different input.
    if (/\[\[INSTRUCTION:/.test(trimmed) && !trimmed.includes(']]')) {
      violations.push(
        `unterminated instruction block starting with "${trimmed.slice(0, 100)}" — ` +
          "close it with ']]' (the closer is part of the same block, not a new line of prose)",
      );
      insideUnclosed = true;
      continue;
    }
    violations.push(trimmed);
  }
  if (skippedAfterUnclosed > 0) {
    violations.push(
      `${skippedAfterUnclosed} further line(s) were not checked: they follow the unterminated ` +
        'instruction block above and are treated as part of it. Close the block and resubmit to check them',
    );
  }
  return violations;
}

/**
 * `[src: ...]` markers whose target is not a wiki page.
 *
 * The authoring contract is `[src: wiki/path.md]` only: a citation is an anchor
 * the build expands into a wiki-backed reference. Citing a raw source
 * (`raw/untracked/...`) puts a volatile path into every deliverable the
 * template produces — the file is archived the moment it is ingested, and the
 * built document then carries a dead link that no refresh can repair. Reusable
 * context belongs in build-context/ (declared through the `build_context`
 * frontmatter), never in a citation.
 */
export function templateCitationViolations(content: string): string[] {
  const parsed = matter(content);
  const violations = new Set<string>();
  for (const match of parsed.content.matchAll(/\[src:\s*([^\]]+)\]/gi)) {
    const target = String(match[1] ?? '').trim().replace(/\\/g, '/');
    if (target && !target.startsWith('wiki/')) violations.add(target);
  }
  return [...violations];
}

export interface WikiMcpServices {
  workspace: WorkspaceService;
  retrieval: RetrievalService;
}

export const WIKI_MCP_TOOLS = [
  {
    name: 'wiki_workspace_status',
    description:
      'Read the canonical local workspace inventory in one call: pending raw sources, ingested sources, wiki pages, templates, build context, and deliverables. Use first for questions about what exists or is waiting in the workspace.',
  },
  {
    name: 'wiki_list_pages',
    description:
      'List llm-wiki markdown pages under wiki/. Use this only for the llm-wiki knowledge base, not CME runtime configuration.',
  },
  {
    name: 'wiki_read_page',
    description:
      'Read one llm-wiki markdown page (wiki/, raw/ingested/, or raw/untracked/) by relative path. Use for targeted inspection when a page needs full content. The result ends with a wiki_read_page sources comment naming every [src: ...] citation in the page — follow a wiki/... target with this same tool (or wiki_read_pages) and a raw/ingested/... target with wiki_read_ingested_source; do not re-read a file whose content you already hold.',
  },
  {
    name: 'wiki_read_pages',
    description:
      'Read multiple llm-wiki markdown pages (wiki/, raw/ingested/, or raw/untracked/) by relative path in one call. Use after wiki_search_context, or after wiki_collect_context when additional pages are needed. Each entry carries path, content, found, allowed, truncated, citations (the [src: ...] paths of the page) and links (its [[...]] wiki targets) — follow them with this same tool or wiki_read_ingested_source, and do not re-read a path already returned.',
  },
  {
    name: 'wiki_write_page',
    description:
      'Create or update one llm-wiki markdown page under wiki/. Use this only for wiki content edits.',
  },
  {
    name: 'wiki_outline',
    description:
      'Structural map of the wiki: communities, their size and their most connected pages, without page content. Use first when designing a template, to anchor sections on parts of the wiki that hold material.',
  },
  {
    name: 'template_read',
    description:
      'Read one template under templates/ with its output path and build_context report, or list every template when no path is given.',
  },
  {
    name: 'wiki_read_deliverable',
    description:
      'Read one generated deliverable under deliverables/ by relative path, or list every deliverable when no path is given. Use to inspect the generated output of a build (e.g. a generated presentation) before simplifying or correcting its template.',
  },
  {
    name: 'template_write',
    description:
      'Create or update one template under templates/. A template is a generation spec: an OKF-style frontmatter (title, description, and an explicit build_context list — use [] for none; the write is refused without the build_context key) followed by headings and multiline [[INSTRUCTION: ...]] blocks, nothing else — never prewritten prose, never notes about the template itself. Do NOT write [src: ...] citations in a template: they are the build model\'s job, not the template author\'s — an instruction may state that every claim must be cited, and the build fills the markers in at build time. Citing a raw source (raw/untracked/...) is refused outright because the file is archived once ingested — put reusable context in build-context/ instead. Instruction blocks state WHAT to produce and HOW to format it (sections, tables, bullet lists, length, language), never the facts themselves: no vendor comparisons, figures, dates, conclusions or any claim — facts are pulled from the wiki at build time. Refused (with the offending lines) when the body contains prose outside an instruction block, when a citation targets a non-wiki path, or when the frontmatter has no explicit build_context list; preview unless confirm=true; refused while a production job is running.',
  },
  {
    name: 'build_context_write',
    description:
      'Create or update one shared rule under build-context/. Preview unless confirm=true; reports how many templates it would invalidate; refused while a production job is running.',
  },
  {
    name: 'wiki_add_source',
    description:
      'Stage one Markdown source in the workspace ingestion inbox. Use for content already available as Markdown; use the documents agent for binary conversion or OCR.',
  },
  {
    name: 'wiki_list_ingested_sources',
    description:
      'List source documents already ingested into llm-wiki under raw/ingested/. Do not use this for CME configured export sources.',
  },
  {
    name: 'wiki_read_ingested_source',
    description:
      'Read one llm-wiki ingested source document under raw/ingested/. Use when archived raw source content is needed to verify or deepen the wiki synthesis.',
  },
  {
    name: 'wiki_search_context',
    description:
      'Search llm-wiki for a question. Returns ranked candidate paths with excerpts, citations, and relatedPaths only; excerpts are for triage, not full evidence. Prefer wiki_collect_context for synthesis, architecture, audit, functional analysis, or comparison questions, but call this again if coverage is insufficient.',
  },
  {
    name: 'wiki_collect_context',
    description:
      'Search llm-wiki, read up to 10 returned wiki pages by default, and report coverage in one call. Prefer this first for synthesis, architecture, audit, functional analysis, or comparison questions.',
  },
  {
    name: 'profile_read',
    description:
      'Read the workspace profile from .wiki/profile.md. Returns the full content, character count, and maxProfileChars limit.',
  },
  {
    name: 'profile_update',
    description:
      'Write the workspace profile to .wiki/profile.md. Use only when the user explicitly asks to remember, persist, summarize, or update durable profile information.',
  },
  {
    name: 'help_list',
    description:
      'Product help: list the DONNA documentation chapters (table of contents). Call this for questions about the application itself — what it is, chat vs agent mode, interfaces, getting started, "I\'m lost", troubleshooting. Product documentation, not the workspace wiki.',
  },
  {
    name: 'help_read',
    description:
      'Product help: read one DONNA documentation chapter by id (from help_list). Use to answer a question about the application itself. Not the workspace wiki.',
  },
  {
    name: 'help_search',
    description:
      'Product help: search the bundled DONNA/wikiLLM documentation and return the most relevant chapters. Product documentation, not workspace content.',
  },
] as const;

function relativeWorkspacePaths(workspace: WorkspaceService, paths: string[]): string[] {
  return paths.map((item) =>
    path.relative(workspace.paths.rootDir, item).replaceAll('\\', '/'),
  );
}

export async function workspaceStatusPayload(workspace: WorkspaceService) {
  const [
    pendingSources,
    ingestedSources,
    wikiPages,
    templates,
    buildContext,
    deliverables,
  ] = await Promise.all([
    workspace.listUntrackedSourcePaths(),
    workspace.listIngestedSourcePages(),
    workspace.listWikiPages(),
    workspace.listTemplatePaths(),
    workspace.readBuildContext(),
    workspace.listDeliverablePaths(),
  ]);
  return {
    workspace: { root: workspace.paths.rootDir },
    pendingSources: {
      count: pendingSources.length,
      files: relativeWorkspacePaths(workspace, pendingSources),
    },
    ingestedSources: {
      count: ingestedSources.length,
      files: ingestedSources.map((item) => item.relativePath),
    },
    wikiPages: {
      count: wikiPages.length,
      files: wikiPages.map((item) => item.relativePath),
    },
    templates: {
      count: templates.length,
      files: relativeWorkspacePaths(workspace, templates),
    },
    buildContext: {
      fileCount: buildContext.fileCount,
      truncated: buildContext.truncated,
    },
    deliverables: {
      count: deliverables.length,
      files: relativeWorkspacePaths(workspace, deliverables),
    },
  };
}

const DEFAULT_COLLECT_CONTEXT_RESULTS = 10;
const MAX_SEARCH_CONTEXT_RESULTS = 50;
const MAX_COLLECT_CONTEXT_RESULTS = 25;
const MAX_READ_PAGES = 25;
const MAX_PAGE_CHARS = 50_000;
const DEFAULT_COLLECT_PAGE_CHARS = 24_000;

export function checkMcpAccessKey(
  config: AppConfig,
  providedKey: string | undefined,
): boolean {
  return config.mcp.accessKey === undefined || providedKey === config.mcp.accessKey;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n[truncated]`;
}

function textResult(text: string, options?: { isError?: boolean }): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(options?.isError ? { isError: true } : {}),
  };
}

function diffPreview(before: string, after: string): string {
  if (before === after) return 'No content change.';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let firstChange = 0;
  while (
    firstChange < beforeLines.length &&
    firstChange < afterLines.length &&
    beforeLines[firstChange] === afterLines[firstChange]
  ) {
    firstChange += 1;
  }
  let beforeTail = beforeLines.length - 1;
  let afterTail = afterLines.length - 1;
  while (
    beforeTail >= firstChange &&
    afterTail >= firstChange &&
    beforeLines[beforeTail] === afterLines[afterTail]
  ) {
    beforeTail -= 1;
    afterTail -= 1;
  }
  const start = Math.max(0, firstChange - 3);
  const endBefore = Math.min(beforeLines.length - 1, beforeTail + 3);
  const endAfter = Math.min(afterLines.length - 1, afterTail + 3);
  const lines = [
    '--- before',
    '+++ after',
    ...(start > 0 ? ['...'] : []),
    ...beforeLines.slice(start, endBefore + 1).map((line) => `- ${line}`),
    ...afterLines.slice(start, endAfter + 1).map((line) => `+ ${line}`),
    ...(endBefore < beforeLines.length - 1 || endAfter < afterLines.length - 1
      ? ['...']
      : []),
  ];
  return truncateText(lines.join('\n'), 4000);
}

export function createWritePreviewPayload({
  target,
  before,
  after,
  confirmed,
  dryRun,
  written,
}: {
  target: string;
  before: string;
  after: string;
  confirmed: boolean;
  dryRun: boolean;
  written: boolean;
}) {
  return {
    target,
    dryRun,
    confirmed,
    written,
    requiresConfirmation: !written,
    beforeChars: before.length,
    afterChars: after.length,
    beforeSha256: hashText(before),
    afterSha256: hashText(after),
    changed: before !== after,
    preview: diffPreview(before, after),
  };
}

export function createSourcePreviewPayload({
  target,
  before,
  after,
  dryRun,
  written,
}: {
  target: string;
  before: string;
  after: string;
  dryRun: boolean;
  written: boolean;
}) {
  return {
    target,
    dryRun,
    written,
    beforeChars: before.length,
    afterChars: after.length,
    beforeSha256: hashText(before),
    afterSha256: hashText(after),
    changed: before !== after,
    preview: diffPreview(before, after),
  };
}

async function appendAuditRecord(
  workspace: WorkspaceService,
  record: Record<string, unknown>,
): Promise<void> {
  await mkdir(workspace.paths.logsDir, { recursive: true });
  const auditPath = path.join(workspace.paths.logsDir, 'audit.log');
  await appendFile(
    auditPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      ...record,
    })}\n`,
    'utf8',
  );
}

function resolveWritableWikiPath(
  workspace: WorkspaceService,
  requestedPath: string,
): string {
  return resolveWritablePath(workspace, requestedPath, workspace.paths.wikiDir, 'wiki/');
}

/**
 * Generalized form of the wiki write guard: confine a caller-supplied relative
 * path under one specific workspace directory.
 *
 * Exported for tests — the decode step must never weaken the boundary check.
 * A path is accepted either relative to the workspace root (`templates/x.md`)
 * or relative to the target directory itself (`x.md`), which is the same
 * leniency `resolveTemplateBuildContext` already grants to `build_context`
 * entries. Everything else — `..`, absolute paths, percent-encoded traversal,
 * Windows separators — is refused.
 */
export function resolveWritablePath(
  workspace: WorkspaceService,
  requestedPath: string,
  targetDir: string,
  label: string,
): string {
  let decodedPath = requestedPath.trim();
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Malformed percent sequences stay literal; the boundary check below
    // remains authoritative either way.
  }
  const normalizedPath = decodedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalizedPath) {
    throw new Error(`Access denied: path must be under ${label}`);
  }
  const relativeTargetDir = path
    .relative(workspace.paths.rootDir, targetDir)
    .replaceAll('\\', '/');
  const candidate = normalizedPath.startsWith(`${relativeTargetDir}/`)
    ? resolveInside(workspace.paths.rootDir, normalizedPath)
    : resolveInside(targetDir, normalizedPath);
  const relativeToTarget = path.relative(targetDir, candidate);
  if (relativeToTarget.startsWith('..') || path.isAbsolute(relativeToTarget)) {
    throw new Error(`Access denied: path must be under ${label}`);
  }
  return candidate;
}

function requireMarkdownPath(relativePath: string): void {
  if (!relativePath.toLowerCase().endsWith('.md')) {
    throw new Error(`Only .md files can be written here: ${relativePath}`);
  }
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeMaxPageChars(
  requested: number | undefined,
  fallback?: number,
): number | undefined {
  const value = requested ?? fallback;
  return typeof value === 'number' ? Math.min(value, MAX_PAGE_CHARS) : undefined;
}

interface ReadWikiPagePayload {
  path: string;
  found: boolean;
  allowed: boolean;
  truncated: boolean;
  content: string;
  // The page's provenance, surfaced structurally so the caller can follow it:
  // citations are [src: ...] paths (wiki/... pages or raw/ingested/... archive
  // sources), links are wiki-internal [[...]] targets. Content alone forced
  // the caller to re-parse markdown it already held.
  citations?: string[];
  links?: string[];
  error?: string;
}

async function readWorkspaceWikiPage(
  workspace: WorkspaceService,
  pagePath: string,
  options?: { maxPageChars?: number },
): Promise<ReadWikiPagePayload> {
  try {
    const absolutePath = resolveReadableWorkspacePath(workspace, pagePath);
    if (!(await pathExists(absolutePath))) {
      return {
        path: pagePath,
        found: false,
        allowed: true,
        truncated: false,
        content: '',
        error: `Page not found: ${pagePath}`,
      };
    }

    const content = await readFile(absolutePath, 'utf8');
    const maxPageChars = options?.maxPageChars;
    const truncated =
      typeof maxPageChars === 'number' &&
      maxPageChars > 0 &&
      content.length > maxPageChars;
    return {
      path: pagePath,
      found: true,
      allowed: true,
      truncated,
      content: truncated
        ? `${content.slice(0, maxPageChars).trimEnd()}\n[truncated]`
        : content,
      citations: [...new Set(extractSourceCitations(content))],
      links: [...new Set(extractWikiLinks(content))],
    };
  } catch (error) {
    return {
      path: pagePath,
      found: false,
      allowed: false,
      truncated: false,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loggedTool<T>(
  name: string,
  input: T,
  handler: (input: T) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const start = performance.now();
  console.log(`[wiki-mcp] tools/call ${name}`);
  try {
    const result = await handler(input);
    const status = result.isError ? 'error' : 'ok';
    console.log(
      `[wiki-mcp] tools/result ${name} ${status} ${Math.round(performance.now() - start)}ms`,
    );
    return result;
  } catch (error) {
    console.log(
      `[wiki-mcp] tools/result ${name} exception ${Math.round(performance.now() - start)}ms ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

// Exported for tests: the decode step must never weaken the boundary checks.
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
  const underRoot = !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot);
  const underWiki = !relativeToWiki.startsWith('..') && !path.isAbsolute(relativeToWiki);
  const underIngested =
    !relativeToIngested.startsWith('..') && !path.isAbsolute(relativeToIngested);
  const underUntracked =
    !relativeToUntracked.startsWith('..') && !path.isAbsolute(relativeToUntracked);

  if (!underRoot || (!underWiki && !underIngested && !underUntracked)) {
    // Name the tool that DOES read this tree. The bare refusal sent the caller
    // looping — it read the templates listing, tried this tool again on a
    // templates/ path, was refused again, and eventually wrote a new template
    // rather than reading the one it was asked to edit.
    const suggestion = relativeToRoot.startsWith('templates/')
      ? ' Use template_read for templates/.'
      : relativeToRoot.startsWith('deliverables/')
        ? ' Deliverables are generated: read the template that produces it with template_read, or the wiki pages it cites.'
        : relativeToRoot.startsWith('build-context/')
          ? ' build-context/ is applied at build time, not read here; template_read reports which files a template resolves.'
          : '';
    throw new Error(
      `Access denied: path must be under wiki/, raw/ingested/, or raw/untracked/.${suggestion}`,
    );
  }

  return absolutePath;
}

export async function createWikiMcpServices(config: AppConfig): Promise<WikiMcpServices> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const retrieval = new RetrievalService(workspace, config);
  return { workspace, retrieval };
}

export async function createWikiMcpServer(
  config: AppConfig,
  services?: WikiMcpServices,
): Promise<McpServer> {
  const { workspace, retrieval } = services ?? (await createWikiMcpServices(config));
  const server = new McpServer({
    name: 'llm-wiki',
    version: LLM_WIKI_VERSION,
  });
  const history = new HistoryService(workspace.paths.rootDir, config.history);

  const listWikiPages = async () => {
    const pages = await workspace.listWikiPages();
    const items = pages.map((p) => `${p.relativePath} [${p.type}]`);
    return textResult(items.join('\n'));
  };

  const readWorkspaceStatus = async () =>
    textResult(JSON.stringify(await workspaceStatusPayload(workspace), null, 2));

  const readWikiPage = async ({ path: pagePath }: { path: string }) => {
    try {
      const page = await readWorkspaceWikiPage(workspace, pagePath);
      if (!page.allowed) {
        return textResult('Access denied: path must be under wiki/, raw/ingested/, or raw/untracked/.', { isError: true });
      }
      if (!page.found) {
        return textResult(`Page not found: ${pagePath}`, { isError: true });
      }
      // The content stays the page, verbatim; the trailer is tool furniture,
      // not page text — never write it back. It names the page's real sources
      // so the caller can follow them with wiki_read_page/wiki_read_pages (for
      // wiki/... targets) or wiki_read_ingested_source (for raw/ingested/...),
      // without having to parse the markdown itself or re-read a page it
      // already holds.
      const trailer =
        page.citations && page.citations.length > 0
          ? `\n\n<!-- wiki_read_page sources: ${page.citations.join(', ')} -->`
          : '';
      return textResult(page.content + trailer);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }
  };

  const readWikiPages = async ({
    paths,
    maxPageChars,
  }: {
    paths: string[];
    maxPageChars?: number;
  }) => {
    const requestedPaths = uniqueValues(paths);
    if (requestedPaths.length > MAX_READ_PAGES) {
      return textResult(
        `Too many pages requested: ${requestedPaths.length}. Maximum is ${MAX_READ_PAGES}.`,
        { isError: true },
      );
    }
    const safeMaxPageChars = normalizeMaxPageChars(maxPageChars);
    const pages = await Promise.all(
      requestedPaths.map((pagePath) =>
        readWorkspaceWikiPage(workspace, pagePath, { maxPageChars: safeMaxPageChars }),
      ),
    );
    return textResult(JSON.stringify({ pages }, null, 2));
  };

  const writeWikiPage = async ({
    path: pagePath,
    content,
    confirm,
    dryRun,
  }: {
    path: string;
    content: string;
    confirm?: boolean;
    dryRun?: boolean;
  }) => {
    const absolutePath = resolveWritableWikiPath(workspace, pagePath);
    const before = (await pathExists(absolutePath))
      ? await readFile(absolutePath, 'utf8')
      : '';
    const confirmed = confirm === true;
    const previewOnly = dryRun === true || !confirmed;
    const payload = createWritePreviewPayload({
      target: pagePath,
      before,
      after: content,
      confirmed,
      dryRun: dryRun === true,
      written: !previewOnly,
    });
    if (previewOnly) {
      await appendAuditRecord(workspace, {
        tool: 'wiki_write_page',
        target: pagePath,
        action: dryRun === true ? 'dry_run' : 'preview_required',
        confirmed,
        contentChars: content.length,
        beforeSha256: payload.beforeSha256,
        afterSha256: payload.afterSha256,
      });
      return textResult(
        JSON.stringify(
          {
            ...payload,
            message: 'Preview only. Re-run with confirm=true to write.',
          },
          null,
          2,
        ),
      );
    }
    await workspace.applyWikiOperations([{ type: 'update', path: pagePath, content }]);
    retrieval.invalidateCache();
    await appendAuditRecord(workspace, {
      tool: 'wiki_write_page',
      target: pagePath,
      action: 'write',
      confirmed,
      contentChars: content.length,
      beforeSha256: payload.beforeSha256,
      afterSha256: payload.afterSha256,
    });
    await commitHistorySafely(history, {
      command: 'page',
      message: `page: ${pagePath}`,
      scope: [path.relative(workspace.paths.rootDir, absolutePath).replaceAll('\\', '/')],
    });
    return textResult(`Written: ${pagePath}`);
  };

  /**
   * Shared write path for templates/ and build-context/.
   *
   * Same contract as wiki_write_page (preview → confirm → audit), plus one
   * guard it does not need: a refusal while a production job holds the
   * workspace. See services/productionLocks.ts for why writing to these two
   * directories mid-run can make a job build content it never locked.
   */
  const writeWorkspaceAsset = async (options: {
    tool: string;
    targetDir: string;
    label: string;
    requestedPath: string;
    content: string;
    confirm?: boolean;
    dryRun?: boolean;
    decorate?: (relativePath: string, content: string) => Promise<Record<string, unknown>>;
  }): Promise<CallToolResult> => {
    let absolutePath: string;
    let relativePath: string;
    try {
      absolutePath = resolveWritablePath(
        workspace,
        options.requestedPath,
        options.targetDir,
        options.label,
      );
      relativePath = path.relative(workspace.paths.rootDir, absolutePath).replaceAll('\\', '/');
      requireMarkdownPath(relativePath);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }

    const confirmed = options.confirm === true;
    const previewOnly = options.dryRun === true || !confirmed;
    const before = (await pathExists(absolutePath)) ? await readFile(absolutePath, 'utf8') : '';
    const payload = createWritePreviewPayload({
      target: relativePath,
      before,
      after: options.content,
      confirmed,
      dryRun: options.dryRun === true,
      written: false,
    });
    const decoration = options.decorate
      ? await options.decorate(relativePath, options.content)
      : {};

    if (previewOnly) {
      await appendAuditRecord(workspace, {
        tool: options.tool,
        target: relativePath,
        action: options.dryRun === true ? 'dry_run' : 'preview_required',
        confirmed,
        contentChars: options.content.length,
        beforeSha256: payload.beforeSha256,
        afterSha256: payload.afterSha256,
      });
      return textResult(
        JSON.stringify(
          {
            ...payload,
            ...decoration,
            message: 'NOT WRITTEN — preview only. Re-run with confirm=true to write.',
          },
          null,
          2,
        ),
      );
    }

    // Checked as late as possible, and never on the preview path: a preview is
    // read-only and stays useful while a job runs.
    const busy = await checkProductionIdle(workspace.paths.rootDir);
    if (busy.busy) {
      await appendAuditRecord(workspace, {
        tool: options.tool,
        target: relativePath,
        action: 'rejected_production_busy',
        confirmed,
        contentChars: options.content.length,
        jobs: [...new Set(busy.locks.map((lock) => lock.jobId))],
      });
      return textResult(
        JSON.stringify(
          {
            error: 'PRODUCTION_JOB_ACTIVE',
            message: busy.message,
            target: relativePath,
            written: false,
            activeJobs: busy.locks.map((lock) => ({
              jobId: lock.jobId,
              scopes: lock.scopes,
            })),
          },
          null,
          2,
        ),
        { isError: true },
      );
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, options.content, 'utf8');
    await appendAuditRecord(workspace, {
      tool: options.tool,
      target: relativePath,
      action: 'write',
      confirmed,
      contentChars: options.content.length,
      beforeSha256: payload.beforeSha256,
      afterSha256: payload.afterSha256,
    });
    await commitHistorySafely(history, {
      command: options.tool === 'template_write' ? 'template' : 'build-context',
      message: `${options.tool === 'template_write' ? 'template' : 'build-context'}: ${relativePath}`,
      scope: [relativePath],
    });
    return textResult(
      JSON.stringify(
        { ...payload, ...decoration, written: true, requiresConfirmation: false },
        null,
        2,
      ),
    );
  };

  /**
   * Resolve the build_context selection of a template *before* it is written.
   *
   * This is the whole quality gate of template authoring, and it costs two
   * directory reads: it reports which referenced files exist, which do not,
   * how many characters the selection weighs against maxBuildContextChars,
   * and how many existing deliverables an inherited (key-absent) context would
   * put out of date.
   */
  const describeTemplateBuildContext = async (relativePath: string, content: string) => {
    const parsed = matter(content);
    const sections = await workspace.readBuildContextSections();
    const resolution = workspace.resolveTemplateBuildContext(sections, parsed.data);
    const declared = Object.prototype.hasOwnProperty.call(parsed.data, 'build_context');
    return {
      template: relativePath,
      instructionSlots: parseTemplateInstructions(parsed.content).length,
      buildContext: {
        declared,
        resolved: resolution.resolved,
        missing: resolution.missing,
        fileCount: resolution.context.fileCount,
        chars: resolution.context.rawTotalChars,
        maxChars: config.build.maxBuildContextChars,
        truncated: resolution.context.truncated,
        ...(declared
          ? {}
          : {
              warning:
                'No build_context key: this template inherits every file in build-context/, ' +
                'including rules written for other deliverables. Declare an explicit list ' +
                '(or [] for none).',
            }),
        // A declared entry that resolves to nothing is reported but not fatal,
        // by design — so an invented path (wiki/concepts/product) was written
        // and never noticed, and an author with nothing to go on left the list
        // empty. Naming what actually exists answers both: it is the only way
        // the caller can tell an invented path from a real one.
        ...(resolution.missing.length > 0 || resolution.resolved.length === 0
          ? { available: sections.map((section) => section.relativePath) }
          : {}),
      },
    };
  };


// Listings named files; the reader — human or model — reasons about titles.
// "detaille.md" told nobody what the template produces, so a caller looking for
// the technical presentation guessed a path instead of recognising one. The
// frontmatter title is authoritative and its casing is preserved; the path stays
// beside it because that is what the tools take as input.
const withTitles = async (
  paths: string[],
  read: (absolutePath: string) => Promise<{ frontmatter: Record<string, unknown> }>,
) => Promise.all(
  paths.map(async (absolutePath) => {
    const relativePath = relativeFrom(workspace.paths.rootDir, absolutePath);
    try {
      const parsed = await read(absolutePath);
      const title = typeof parsed.frontmatter.title === 'string' ? parsed.frontmatter.title.trim() : '';
      return title ? { path: relativePath, title } : { path: relativePath };
    } catch {
      return { path: relativePath };
    }
  }),
);

  const readTemplate = async ({ path: requestedPath }: { path?: string }) => {
    if (!requestedPath) {
      const templates = await workspace.listTemplatePaths();
      return textResult(
        JSON.stringify(
          { templates: await withTitles(templates, (file) => workspace.readTemplateDocument(file)) },
          null,
          2,
        ),
      );
    }
    try {
      let absolutePath = resolveWritablePath(
        workspace,
        requestedPath,
        workspace.paths.templatesDir,
        'templates/',
      );
      const relativePath = path
        .relative(workspace.paths.rootDir, absolutePath)
        .replaceAll('\\', '/');
      if (!(await pathExists(absolutePath))) {
        // A bare "not found" taught the caller nothing, so it guessed a flat
        // path (templates/technical-presentation.md), missed the real one
        // (templates/technical/detaille.md), and concluded it had to CREATE a
        // template — producing a near-duplicate beside the one it was asked to
        // edit. First try the exact basename anywhere under templates/ (the
        // recursive search the flat guess implied); only a genuine miss
        // returns the full listing.
        const allTemplates = await workspace.listTemplatePaths();
        const wanted = path.basename(requestedPath);
        const basenameMatches = allTemplates.filter(
          (file) => path.basename(file) === wanted,
        );
        if (basenameMatches.length === 1) {
          absolutePath = basenameMatches[0];
        } else {
          const available = relativeWorkspacePaths(workspace, allTemplates);
          return textResult(
            JSON.stringify(
              {
                error: 'TEMPLATE_NOT_FOUND',
                requested: relativePath,
                message: available.length
                  ? 'No template at that path. Templates live in sub-directories; read one of the existing paths below before creating anything new.'
                  : 'No template at that path, and this workspace has none yet.',
                ...(basenameMatches.length > 1
                  ? {
                      sameName: basenameMatches.map((file) =>
                        relativeFrom(workspace.paths.rootDir, file),
                      ),
                    }
                  : {}),
                templates: available,
              },
              null,
              2,
            ),
            { isError: true },
          );
        }
      }
      const content = await readFile(absolutePath, 'utf8');
      const document = await workspace.readTemplateDocument(absolutePath);
      const described = await describeTemplateBuildContext(relativePath, content);
      return textResult(
        JSON.stringify(
          {
            template: relativePath,
            output: document.outputRelativePath,
            instructionSlots: described.instructionSlots,
            buildContext: described.buildContext,
            content,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }
  };

  const readDeliverable = async ({ path: requestedPath }: { path?: string }) => {
    if (!requestedPath) {
      const deliverables = await workspace.listDeliverablePaths();
      // Titles, not file names: same fix as the template listing. The
      // deliverable frontmatter title is authoritative; the path stays beside
      // it because that is what the tools take as input.
      const readDocument = async (absolutePath: string) => {
        const raw = await readFile(absolutePath, 'utf8');
        return { frontmatter: matter(raw).data };
      };
      const titled = await Promise.all(
        deliverables.map(async (absolutePath) => {
          const relativePath = relativeFrom(workspace.paths.rootDir, absolutePath);
          try {
            const parsed = await readDocument(absolutePath);
            const title =
              typeof parsed.frontmatter.title === 'string'
                ? parsed.frontmatter.title.trim()
                : '';
            return title ? { path: relativePath, title } : { path: relativePath };
          } catch {
            return { path: relativePath };
          }
        }),
      );
      return textResult(JSON.stringify({ deliverables: titled }, null, 2));
    }
    try {
      const absolutePath = resolveWritablePath(
        workspace,
        requestedPath,
        workspace.paths.deliverablesDir,
        'deliverables/',
      );
      const relativePath = path
        .relative(workspace.paths.rootDir, absolutePath)
        .replaceAll('\\', '/');
      if (!(await pathExists(absolutePath))) {
        // Deliverables live in sub-directories too; a bare miss must teach,
        // not punish — the listing is the same information this tool already
        // returns without a path.
        const available = relativeWorkspacePaths(
          workspace,
          await workspace.listDeliverablePaths(),
        );
        return textResult(
          JSON.stringify(
            {
              error: 'DELIVERABLE_NOT_FOUND',
              requested: relativePath,
              message: available.length
                ? 'No deliverable at that path. Deliverables live in sub-directories; use one of the existing paths below.'
                : 'No deliverable at that path, and this workspace has none yet.',
              deliverables: available,
            },
            null,
            2,
          ),
          { isError: true },
        );
      }
      const content = await readFile(absolutePath, 'utf8');
      return textResult(
        JSON.stringify({ deliverable: relativePath, content }, null, 2),
      );
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }
  };

  const writeTemplate = async (input: {
    path: string;
    content: string;
    confirm?: boolean;
    dryRun?: boolean;
  }) => {
    const violations = templateHardContentViolations(input.content);
    const citationViolations = templateCitationViolations(input.content);
    const frontmatter = matter(input.content).data;
    const missingBuildContext = !Object.prototype.hasOwnProperty.call(frontmatter, 'build_context');
    const hardErrors = [
      ...violations.map((line) => ({ kind: 'prose', line })),
      ...citationViolations.map((target) => ({ kind: 'citation', target })),
      ...(missingBuildContext ? [{ kind: 'missing_build_context' }] : []),
    ];
    if (input.confirm === true && hardErrors.length > 0) {
      const shownViolations = violations.slice(0, 12);
      return textResult(
        JSON.stringify(
          {
            error: 'TEMPLATE_HARD_CONTENT',
            message:
              'Templates are instruction-only: a section must be a heading followed by a ' +
              '[[INSTRUCTION: ...]] block, never ' +
              'prewritten prose. Hard prose is copied verbatim into the deliverable on build ' +
              'and can never be refreshed from the wiki. Move these lines inside an ' +
              '[[INSTRUCTION: ...]] block or move the fact to the wiki and cite it. ' +
              'Citations are the build model\'s job, not the template author\'s: do not write ' +
              '[src: ...] markers in a template — the instruction may say where facts should ' +
              'be cited, and the build fills them in. ' +
              'Lines that only describe the template itself (footer notes, annex lists, ' +
              'glossaries) are hard content too: delete them — the template body must ' +
              'contain nothing but headings and instruction blocks.',
            violations: shownViolations,
            ...(violations.length > shownViolations.length
              ? { truncatedViolations: violations.length - shownViolations.length }
              : {}),
            ...(citationViolations.length > 0
              ? {
                  citationViolations,
                  citationRule:
                    'Citations must point at wiki pages only ([src: wiki/...]). Citing a raw ' +
                    'source (raw/untracked/...) puts a volatile path into every built deliverable. ' +
                    'Ingest the source into the wiki and cite the resulting page, or move reusable ' +
                    'context into build-context/ and declare it in build_context.',
                }
              : {}),
            ...(missingBuildContext
              ? {
                  missingBuildContext: {
                    message:
                      'No build_context key in the frontmatter: this template would inherit every ' +
                      'file in build-context/, including rules written for other deliverables. ' +
                      'Declare an explicit list (or [] for none).',
                  },
                }
              : {}),
          },
          null,
          2,
        ),
        { isError: true },
      );
    }
    return writeWorkspaceAsset({
      tool: 'template_write',
      targetDir: workspace.paths.templatesDir,
      label: 'templates/',
      requestedPath: input.path,
      content: input.content,
      confirm: input.confirm,
      dryRun: input.dryRun,
      decorate: async (relativePath, content) => ({
        ...(await describeTemplateBuildContext(relativePath, content)),
        ...(violations.length > 0
          ? {
              instructionViolations: {
                message:
                  'This template contains prose outside [[INSTRUCTION: ...]] blocks; ' +
                  'it will be refused on confirm=true. Move these lines inside an ' +
                  '[[INSTRUCTION: ...]] block or move the fact to the wiki and cite it. ' +
                  'Lines that only describe the template itself (footer notes, annex lists, ' +
                  'glossaries) are hard content too: delete them.',
                lines: violations.slice(0, 12),
                ...(violations.length > 12
                  ? { truncatedLines: violations.length - 12 }
                  : {}),
              },
            }
          : {}),
        ...(citationViolations.length > 0
          ? {
              citationViolations: {
                message:
                  'Citations must point at wiki pages only ([src: wiki/...]). ' +
                  'This template will be refused on confirm=true while it cites these targets.',
                targets: citationViolations,
              },
            }
          : {}),
        ...(missingBuildContext
          ? {
              missingBuildContext: {
                message:
                  'No build_context key in the frontmatter: this template would inherit every ' +
                  'file in build-context/. Declare an explicit list (or [] for none); ' +
                  'the write will be refused on confirm=true without it.',
              },
            }
          : {}),
      }),
    });
  };

  const writeBuildContext = async (input: {
    path: string;
    content: string;
    confirm?: boolean;
    dryRun?: boolean;
  }) =>
    writeWorkspaceAsset({
      tool: 'build_context_write',
      targetDir: workspace.paths.buildContextDir,
      label: 'build-context/',
      requestedPath: input.path,
      content: input.content,
      confirm: input.confirm,
      dryRun: input.dryRun,
      // Adding a context file changes the global context hash, so every
      // template that did NOT declare a build_context list is no longer fresh
      // and will be rebuilt. Say how many before the write, not after.
      decorate: async () => {
        const templates = await workspace.listTemplatePaths();
        const inheriting: string[] = [];
        for (const templatePath of templates) {
          const document = await workspace.readTemplateDocument(templatePath);
          if (!Object.prototype.hasOwnProperty.call(document.frontmatter, 'build_context')) {
            inheriting.push(document.relativePath);
          }
        }
        return {
          invalidatesOnNextBuild: {
            count: inheriting.length,
            templates: inheriting,
            note:
              'These templates declare no build_context list, so they inherit the global ' +
              'context; changing it makes their deliverables stale on the next build.',
          },
        };
      },
    });

  const readWikiOutline = async ({
    maxCommunities,
    maxPagesPerCommunity,
  }: {
    maxCommunities?: number;
    maxPagesPerCommunity?: number;
  }) => {
    const snapshot = await loadWikiGraphSnapshot({
      rootDir: workspace.paths.rootDir,
      language: config.language,
    });
    const outline = summarizeWikiGraph(snapshot, {
      maxCommunities,
      maxPagesPerCommunity,
    });
    return textResult(
      JSON.stringify(
        {
          ...outline,
          ...(outline.degenerate
            ? {
                warning:
                  'No explicit communities: every page fell back to the default label. ' +
                  'This is not a topology — ingest content before deriving template ' +
                  'sections from it.',
              }
            : {}),
        },
        null,
        2,
      ),
    );
  };

  const addWikiSource = async ({
    name,
    content,
    subdir,
    overwrite,
    dryRun,
  }: {
    name: string;
    content: string;
    subdir?: string;
    overwrite?: boolean;
    dryRun?: boolean;
  }) => {
    const inspected = await workspace.inspectUntrackedSource({ name, subdir });
    const preview = createSourcePreviewPayload({
      target: inspected.relativePath,
      before: inspected.content,
      after: content,
      dryRun: dryRun === true,
      written: dryRun !== true,
    });
    if (dryRun === true) {
      await appendAuditRecord(workspace, {
        tool: 'wiki_add_source',
        target: inspected.relativePath,
        action: 'dry_run',
        contentChars: content.length,
        contentBytes: Buffer.byteLength(content, 'utf8'),
        beforeSha256: preview.beforeSha256,
        afterSha256: preview.afterSha256,
      });
      return textResult(JSON.stringify(preview, null, 2));
    }
    if (inspected.existed && overwrite !== true) {
      await appendAuditRecord(workspace, {
        tool: 'wiki_add_source',
        target: inspected.relativePath,
        action: 'rejected_exists',
        contentChars: content.length,
        beforeSha256: preview.beforeSha256,
        afterSha256: preview.afterSha256,
      });
      return textResult(
        JSON.stringify(
          {
            error: 'SOURCE_ALREADY_EXISTS',
            message: `Source already exists (set overwrite=true): ${inspected.relativePath}`,
            target: inspected.relativePath,
            written: false,
          },
          null,
          2,
        ),
        { isError: true },
      );
    }
    let result;
    try {
      result = await workspace.writeUntrackedSource({ name, content, subdir, overwrite });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'SOURCE_ALREADY_EXISTS') throw error;
      await appendAuditRecord(workspace, {
        tool: 'wiki_add_source',
        target: inspected.relativePath,
        action: 'rejected_exists',
        contentChars: content.length,
        beforeSha256: preview.beforeSha256,
        afterSha256: preview.afterSha256,
      });
      return textResult(
        JSON.stringify(
          {
            error: 'SOURCE_ALREADY_EXISTS',
            message: error instanceof Error ? error.message : String(error),
            target: inspected.relativePath,
            written: false,
          },
          null,
          2,
        ),
        { isError: true },
      );
    }
    await appendAuditRecord(workspace, {
      tool: 'wiki_add_source',
      target: result.relativePath,
      action: 'write',
      contentChars: content.length,
      contentBytes: result.bytes,
      beforeSha256: preview.beforeSha256,
      afterSha256: preview.afterSha256,
      overwritten: result.overwritten,
    });
    return textResult(
      JSON.stringify(
        {
          ...preview,
          written: true,
          relativePath: result.relativePath,
          bytes: result.bytes,
          overwritten: result.overwritten,
        },
        null,
        2,
      ),
    );
  };

  const listIngestedSources = async () => {
    const pages = await workspace.listIngestedSourcePages();
    if (pages.length === 0) {
      return textResult('No ingested sources found.');
    }
    const items = pages.map((p) => p.relativePath);
    return textResult(items.join('\n'));
  };

  const readIngestedSource = async ({ path: sourcePath }: { path: string }) => {
    try {
      const absolutePath = resolveReadableWorkspacePath(workspace, sourcePath);
      const relative = path.relative(workspace.paths.rawIngestedDir, absolutePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return textResult('Access denied: path must be under raw/ingested/', {
          isError: true,
        });
      }
      if (!(await pathExists(absolutePath))) {
        return textResult(`Source not found: ${sourcePath}`, { isError: true });
      }
      const content = await readFile(absolutePath, 'utf8');
      return textResult(content);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }
  };

  const searchWikiContextInput = {
    question: z.string().min(1).describe('Question or topic to search for.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_CONTEXT_RESULTS)
      .optional()
      .describe(
        'Maximum ranked candidates to return. Omit to use retrieval.vector.maxResults when vector retrieval is enabled, otherwise retrieval.maxContextFiles.',
      ),
    includeRaw: z
      .boolean()
      .optional()
      .describe(
        'Whether to include raw/ingested source files in addition to wiki pages. Default false; prefer wiki/sources and wiki/concepts unless the raw archived source is explicitly needed.',
      ),
    maxExcerptChars: z
      .number()
      .int()
      .min(200)
      .max(6000)
      .optional()
      .describe('Maximum excerpt size per result.'),
  };
  const searchWikiContext = async ({
    question,
    maxResults,
    includeRaw,
    maxExcerptChars,
  }: {
    question: string;
    maxResults?: number;
    includeRaw?: boolean;
    maxExcerptChars?: number;
  }) => {
    const results = await retrieval.search(question, {
      limit:
        maxResults ??
        (config.retrieval.vector.enabled
          ? config.retrieval.vector.maxResults
          : config.retrieval.maxContextFiles),
      includeRaw: includeRaw ?? false,
    });
    const excerptLimit = maxExcerptChars ?? config.retrieval.maxChunkChars;
    const payload = {
      question,
      results: results.map((result) => {
        const excerpt = result.chunk?.content ?? result.page.content;
        return {
          path: result.page.relativePath,
          type: result.page.type,
          score: result.score,
          headingPath: result.chunk?.headingPath ?? [],
          excerpt: truncateText(excerpt, excerptLimit),
          citations: extractSourceCitations(excerpt),
          relatedPaths: result.relatedPaths ?? [],
        };
      }),
    };
    return textResult(JSON.stringify(payload, null, 2));
  };

  const collectWikiContext = async ({
    question,
    maxResults,
    maxPageChars,
  }: {
    question: string;
    maxResults?: number;
    maxPageChars?: number;
  }) => {
    const resultLimit = Math.min(
      maxResults ?? DEFAULT_COLLECT_CONTEXT_RESULTS,
      MAX_COLLECT_CONTEXT_RESULTS,
    );
    const safeMaxPageChars = normalizeMaxPageChars(
      maxPageChars,
      DEFAULT_COLLECT_PAGE_CHARS,
    );
    const results = await retrieval.search(question, {
      limit: resultLimit,
      includeRaw: false,
    });
    const excerptLimit = config.retrieval.maxChunkChars;
    const candidateResults = results.map((result) => {
      const excerpt = result.chunk?.content ?? result.page.content;
      return {
        path: result.page.relativePath,
        type: result.page.type,
        score: result.score,
        headingPath: result.chunk?.headingPath ?? [],
        excerpt: truncateText(excerpt, excerptLimit),
        citations: extractSourceCitations(excerpt),
        relatedPaths: result.relatedPaths ?? [],
      };
    });
    const readPaths = uniqueValues(
      candidateResults
        .map((result) => result.path)
        .filter((resultPath) => resultPath.startsWith('wiki/')),
    );
    const readPages = await Promise.all(
      readPaths.map((pagePath) =>
        readWorkspaceWikiPage(workspace, pagePath, { maxPageChars: safeMaxPageChars }),
      ),
    );
    const readPagePaths = readPages
      .filter((page) => page.found && page.allowed)
      .map((page) => page.path);
    const notReadRawSources = uniqueValues(
      candidateResults.flatMap((result) =>
        [...result.citations, ...result.relatedPaths].filter((sourcePath) =>
          sourcePath.startsWith('raw/ingested/'),
        ),
      ),
    );
    const payload = {
      usageContract: {
        primaryEvidence: 'readPages',
        readPagesMeaning:
          'Pages listed in readPagePaths were opened and their returned content is available in readPages. Check truncated before treating a page as complete.',
        excerptsRole:
          'candidateResults.excerpt explains why a page was selected; it is search trace, not the primary evidence.',
        followUpPolicy:
          'If readPages do not provide enough evidence, the client may call wiki_search_context, wiki_read_page, wiki_read_pages, or wiki_read_ingested_source to improve coverage.',
        rawSourcesPolicy:
          'notReadRawSources are traceability references only; they were not opened and should not be treated as read evidence.',
      },
      question,
      candidateResults,
      readPagePaths,
      readPages,
      notReadRawSources,
      coverage: {
        requestedResultLimit: resultLimit,
        candidateCount: candidateResults.length,
        readPageCount: readPagePaths.length,
        missingPageCount: readPages.filter((page) => !page.found && page.allowed).length,
        deniedPageCount: readPages.filter((page) => !page.allowed).length,
        truncatedPageCount: readPages.filter((page) => page.truncated).length,
        notReadRawSourceCount: notReadRawSources.length,
      },
    };
    console.log(
      `[wiki-mcp] collect_context candidates=${candidateResults.length} readPages=${readPagePaths.length} truncated=${payload.coverage.truncatedPageCount} rawRefs=${notReadRawSources.length} readPaths=${readPagePaths.join(',')}`,
    );
    return textResult(JSON.stringify(payload, null, 2));
  };

  // MCP readOnlyHint annotation: declares non-mutating tools per the MCP spec.
  // The manager reads it (annotations.readOnlyHint) so these tools qualify as
  // read tools for /chat regardless of naming conventions. Never put it on a
  // mutating tool (wiki_write_page, wiki_add_source, profile_update).
  const READ_ONLY = { readOnlyHint: true };

  // ── The queryable graph ─────────────────────────────────────────────────────
  // The transverse edges (shared subject, shared tags) were never
  // materialized, so no agent could ask "which pages share this subject" or
  // "what sits between this source and that concept". These two tools answer
  // that over the live corpus — the graph is rebuilt per call, never cached.

  const queryGraphContext = async () => buildQueryGraph(workspace);

  const graphNodeSummary = (node: {
    id: string;
    label: string;
    type: string;
    subject?: string;
    concept?: string;
    tags: string[];
  }) => ({
    path: node.id,
    label: node.label,
    type: node.type,
    ...(node.subject ? { subject: node.subject } : {}),
    ...(node.concept ? { concept: node.concept } : {}),
    tags: node.tags,
  });

  const readGraphQuery = async (input: {
    node?: string;
    concept?: string;
    tag?: string;
    edgeTypes?: string[];
    maxDepth?: number;
    limit?: number;
  }) => {
    const graph = await queryGraphContext();
    if (input.node) {
      const normalized = String(input.node).replace(/\.md$/, '');
      if (!graph.nodeById.has(normalized)) {
        return textResult(`Graph node not found: ${input.node}`, { isError: true });
      }
      const neighbors = graphNeighbors(graph, normalized, {
        edgeTypes: input.edgeTypes as never,
        maxDepth: input.maxDepth,
        limit: input.limit,
      });
      return textResult(
        JSON.stringify(
          {
            node: graphNodeSummary(graph.nodeById.get(normalized)!),
            neighbors: neighbors.map((entry) => ({
              ...graphNodeSummary(entry.node),
              edgeType: entry.edgeType,
              depth: entry.depth,
            })),
          },
          null,
          2,
        ),
      );
    }
    if (input.concept) {
      const nodes = graphNodesByConcept(graph, String(input.concept)).map(graphNodeSummary);
      return textResult(
        JSON.stringify(
          { concept: input.concept, count: nodes.length, nodes: nodes.slice(0, input.limit ?? 50) },
          null,
          2,
        ),
      );
    }
    if (input.tag) {
      const nodes = graphNodesByTag(graph, String(input.tag)).map(graphNodeSummary);
      return textResult(
        JSON.stringify(
          { tag: input.tag, count: nodes.length, nodes: nodes.slice(0, input.limit ?? 50) },
          null,
          2,
        ),
      );
    }
    return textResult(
      JSON.stringify(
        {
          error: 'name one selector: node, concept, or tag',
          nodeCount: graph.nodes.length,
          concepts: [...graph.byConcept.entries()].map(([concept, ids]) => ({ concept, count: ids.length })).sort((a, b) => b.count - a.count).slice(0, 30),
          tags: [...graph.byTag.entries()].map(([tag, ids]) => ({ tag, count: ids.length })).sort((a, b) => b.count - a.count).slice(0, 30),
        },
        null,
        2,
      ),
    );
  };

  const readGraphPath = async (input: { from: string; to: string; edgeTypes?: string[] }) => {
    const graph = await queryGraphContext();
    const from = String(input.from).replace(/\.md$/, '');
    const to = String(input.to).replace(/\.md$/, '');
    const path = graphShortestPath(graph, from, to, { edgeTypes: input.edgeTypes as never });
    if (!path) {
      return textResult(
        JSON.stringify({ from: input.from, to: input.to, path: null, message: 'no path found between these nodes' }, null, 2),
      );
    }
    return textResult(
      JSON.stringify(
        {
          from: input.from,
          to: input.to,
          length: path.length - 1,
          path: path.map((entry) => ({
            ...graphNodeSummary(entry.node),
            via: entry.edgeType,
          })),
        },
        null,
        2,
      ),
    );
  };

  server.tool(
    'wiki_graph_query',
    'Query the knowledge graph: the neighbors of a page (citations, wiki links, shared subject, shared tags), or the pages of a concept or tag. Use to trace how pages relate — which pages share a subject, which pages a source produced, what a concept contains — without reading page content.',
    {
      node: z.string().optional().describe('Relative page path (wiki/... or raw/ingested/...) to start from; omit to list concepts and tags'),
      concept: z.string().optional().describe('Concept folder name (e.g. "product"); lists its pages'),
      tag: z.string().optional().describe('Tag value; lists the pages carrying it'),
      edgeTypes: z.array(z.string()).optional().describe('Restrict the traversal to edge types: citation, produces, wiki_link, shared_subject, shared_tag'),
      maxDepth: z.number().int().min(1).max(3).optional().describe('Neighbor depth, default 1'),
      limit: z.number().int().min(1).max(200).optional().describe('Result cap, default 50'),
    },
    READ_ONLY,
    (input) => loggedTool('wiki_graph_query', input, readGraphQuery),
  );

  server.tool(
    'wiki_graph_path',
    'Find the shortest path between two pages in the knowledge graph, with the edge type of each hop. Use to explain HOW two documents are related before reading them.',
    {
      from: z.string().describe('Relative path of the start page (wiki/... or raw/ingested/...)'),
      to: z.string().describe('Relative path of the end page'),
      edgeTypes: z.array(z.string()).optional().describe('Restrict the traversal to edge types: citation, produces, wiki_link, shared_subject, shared_tag'),
    },
    READ_ONLY,
    (input) => loggedTool('wiki_graph_path', input, readGraphPath),
  );

  server.tool(
    'wiki_workspace_status',
    'Read the canonical local workspace inventory in one call: pending raw sources, ingested sources, wiki pages, templates, build context, and deliverables. Use first for questions about what exists or is waiting in the workspace.',
    {},
    READ_ONLY,
    (input) => loggedTool('wiki_workspace_status', input, readWorkspaceStatus),
  );

  server.tool(
    'wiki_list_pages',
    'List llm-wiki markdown pages under wiki/. Use this only for the llm-wiki knowledge base, not CME runtime configuration.',
    {},
    READ_ONLY,
    (input) => loggedTool('wiki_list_pages', input, listWikiPages),
  );

  const readWikiPageInput = {
    path: z
      .string()
      .describe('Relative path from workspace root under wiki/, raw/ingested/, or raw/untracked/'),
  };
  server.tool(
    'wiki_read_page',
    'Read one markdown document under wiki/, raw/ingested/, or raw/untracked/ by relative path. Use for targeted inspection, including converted documents awaiting ingestion.',
    readWikiPageInput,
    READ_ONLY,
    (input) => loggedTool('wiki_read_page', input, readWikiPage),
  );

  const readWikiPagesInput = {
    paths: z
      .array(z.string())
      .min(1)
      .max(MAX_READ_PAGES)
      .describe('Relative paths from workspace root under wiki/, raw/ingested/, or raw/untracked/'),
    maxPageChars: z
      .number()
      .int()
      .min(500)
      .max(MAX_PAGE_CHARS)
      .optional()
      .describe('Maximum characters returned per page. Omit for full page content.'),
  };
  server.tool(
    'wiki_read_pages',
    'Read multiple markdown documents under wiki/, raw/ingested/, or raw/untracked/ in one call. Returns a JSON object with a `pages` array; each entry has `path`, `content`, `found`, `allowed`, `truncated`, and optionally `error`. Use for selected documents or after context search.',
    readWikiPagesInput,
    READ_ONLY,
    (input) => loggedTool('wiki_read_pages', input, readWikiPages),
  );

  const writeWikiPageInput = {
    path: z.string().describe('Relative path from workspace root, must start with wiki/'),
    content: z.string().describe('Full markdown content to write'),
    confirm: z
      .boolean()
      .optional()
      .describe('Must be true to write. Omit or false returns a diff preview only.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, return the write preview and audit the attempt without writing.',
      ),
  };
  server.tool(
    'wiki_write_page',
    'Create or update one llm-wiki markdown page under wiki/. Returns a diff preview unless confirm=true; dryRun=true never writes.',
    writeWikiPageInput,
    (input) => loggedTool('wiki_write_page', input, writeWikiPage),
  );

  server.tool(
    'wiki_outline',
    'Structural map of the wiki: communities (clusters), their size and their most connected pages. No page content. Use this FIRST when designing a template, to anchor each section on a part of the wiki that actually holds material; then read the pages with wiki_collect_context.',
    {
      maxCommunities: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum communities returned, largest first. Default 40.'),
      maxPagesPerCommunity: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum most-connected pages listed per community. Default 8.'),
    },
    READ_ONLY,
    (input) => loggedTool('wiki_outline', input, readWikiOutline),
  );

  server.tool(
    'template_read',
    'Read one template under templates/, with its resolved output path and build_context report. Omit path to list every template. Use before amending an existing template.',
    {
      path: z
        .string()
        .optional()
        .describe('Relative path, e.g. templates/notes/basic-note.md or notes/basic-note.md'),
    },
    READ_ONLY,
    (input) => loggedTool('template_read', input, readTemplate),
  );

  server.tool(
    'wiki_read_deliverable',
    'Read one generated deliverable under deliverables/ by relative path, or list every deliverable when no path is given. Use to inspect the generated output of a build (e.g. a generated presentation) before simplifying or correcting its template.',
    {
      path: z
        .string()
        .optional()
        .describe('Relative path under deliverables/, e.g. deliverables/presentation.md or presentation.md'),
    },
    READ_ONLY,
    (input) => loggedTool('wiki_read_deliverable', input, readDeliverable),
  );

  const writeAssetInput = {
    content: z.string().describe('Full Markdown content to write.'),
    confirm: z
      .boolean()
      .optional()
      .describe('Must be true to write. Omit or false returns a diff preview only.'),
    dryRun: z
      .boolean()
      .optional()
      .describe('When true, return the preview and audit the attempt without writing.'),
  };

  server.tool(
    'template_write',
    'Create or update one template under templates/. A template is a generation spec: an OKF-style frontmatter (title, description, and an explicit build_context list — use [] for none; the write is refused without the build_context key) followed by headings and multiline [[INSTRUCTION: ...]] blocks, nothing else — never prewritten prose, never notes about the template itself. [src: ...] citations are OPTIONAL, never required: when used they must point at wiki pages only ([src: wiki/...]); citing a raw source (raw/untracked/...) is refused because the file is archived once ingested and the built deliverable would carry a dead link — put reusable context in build-context/ instead. Instruction blocks state WHAT to produce and HOW to format it (sections, tables, bullet lists, length, language), never the facts themselves: no vendor comparisons, figures, dates, conclusions or any claim — facts are pulled from the wiki at build time. The write is refused (with the offending lines) when the body contains prose outside an instruction block, when a citation is not a wiki page, or when the frontmatter has no explicit build_context list. Returns a diff preview unless confirm=true, including which build_context files resolve and which are missing. Refused while a production job is running.',
    {
      path: z
        .string()
        .describe('Relative path under templates/, e.g. templates/notes/basic-note.md'),
      ...writeAssetInput,
    },
    (input) => loggedTool('template_write', input, writeTemplate),
  );

  server.tool(
    'build_context_write',
    'Create or update one shared build-context rule under build-context/. Returns a diff preview unless confirm=true, including how many templates would be rebuilt because they inherit the global context. Refused while a production job is running.',
    {
      path: z
        .string()
        .describe('Relative path under build-context/, e.g. build-context/rules/citations.md'),
      ...writeAssetInput,
    },
    (input) => loggedTool('build_context_write', input, writeBuildContext),
  );

  const addWikiSourceInput = {
    name: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SOURCE_NAME_CHARS)
      .describe(
        'Logical source name. A safe, stable Markdown filename is derived from it.',
      ),
    content: z
      .string()
      .max(MAX_SOURCE_CONTENT_CHARS)
      .describe('Full Markdown content to stage, including front matter when needed.'),
    subdir: z
      .string()
      .trim()
      .max(MAX_SOURCE_SUBDIR_CHARS)
      .optional()
      .describe('Optional relative subdirectory inside the workspace ingestion inbox.'),
    overwrite: z
      .boolean()
      .optional()
      .describe('Must be true to replace an existing staged source. Default false.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, return a diff preview and audit the attempt without writing.',
      ),
  };
  server.tool(
    'wiki_add_source',
    'Stage one Markdown source in the workspace ingestion inbox.',
    addWikiSourceInput,
    (input) => loggedTool('wiki_add_source', input, addWikiSource),
  );

  server.tool(
    'wiki_list_ingested_sources',
    'List source documents already ingested into llm-wiki under raw/ingested/. Do not use this for CME configured export sources.',
    {},
    READ_ONLY,
    (input) => loggedTool('wiki_list_ingested_sources', input, listIngestedSources),
  );

  const readSourceInput = {
    path: z
      .string()
      .describe('Relative path from workspace root, e.g. raw/ingested/doc.md'),
  };
  server.tool(
    'wiki_read_ingested_source',
    'Read one llm-wiki ingested source document under raw/ingested/. Use when archived raw source content is needed to verify or deepen the wiki synthesis.',
    readSourceInput,
    READ_ONLY,
    (input) => loggedTool('wiki_read_ingested_source', input, readIngestedSource),
  );

  server.tool(
    'wiki_search_context',
    'Search llm-wiki for a question. Returns ranked candidate paths with excerpts, citations, and relatedPaths only; excerpts are for triage, not full evidence. Prefer wiki_collect_context for synthesis, architecture, audit, functional analysis, or comparison questions, but call this again if coverage is insufficient.',
    searchWikiContextInput,
    READ_ONLY,
    (input) => loggedTool('wiki_search_context', input, searchWikiContext),
  );

  const collectWikiContextInput = {
    question: z.string().min(1).describe('Question or topic to search for.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_COLLECT_CONTEXT_RESULTS)
      .optional()
      .describe(
        'Maximum ranked candidates to search and read. Omit to read up to 10 wiki pages.',
      ),
    maxPageChars: z
      .number()
      .int()
      .min(500)
      .max(MAX_PAGE_CHARS)
      .optional()
      .describe(
        `Maximum characters returned per read page. Omit to use the default ${DEFAULT_COLLECT_PAGE_CHARS} character safety cap.`,
      ),
  };
  server.tool(
    'wiki_collect_context',
    'Search llm-wiki, read up to 10 returned wiki pages by default, and report coverage in one call. Prefer this first for synthesis, architecture, audit, functional analysis, or comparison questions.',
    collectWikiContextInput,
    READ_ONLY,
    (input) => loggedTool('wiki_collect_context', input, collectWikiContext),
  );

  // ── Product help (global, workspace-agnostic) ────────────────────────────
  // These read the bundled `help-doc/` product documentation, NOT the
  // workspace wiki. Documentation navigation (table of contents + section),
  // not the wiki page taxonomy. Read-only.
  const helpList = async () => {
    const chapters = await listHelpChapters();
    if (chapters.length === 0) {
      return textResult('No product documentation is available.', { isError: true });
    }
    const lines = chapters.map((c) => `${c.id} — ${c.title}`);
    return textResult(
      `DONNA product documentation — chapters. Call help_read with an id to read one.\n\n${lines.join('\n')}`,
    );
  };
  const helpRead = async ({ id }: { id: string }) => {
    const chapter = await readHelpChapter(id);
    if (!chapter.found) {
      const chapters = await listHelpChapters();
      const ids = chapters.map((c) => c.id).join(', ');
      return textResult(
        `${chapter.error ?? 'Chapter not found.'} Available ids: ${ids}`,
        { isError: true },
      );
    }
    return textResult(chapter.content ?? '');
  };

  server.tool(
    'help_list',
    'Product help: list the DONNA documentation chapters (table of contents). Call this for questions about the application ITSELF — what it is, what it\'s for, chat vs agent mode, the interfaces, getting started, "I\'m lost", "it doesn\'t work", troubleshooting. Returns chapter ids and titles; then read the relevant one with help_read. This is product documentation, not the workspace wiki.',
    {},
    READ_ONLY,
    () => loggedTool('help_list', {}, helpList),
  );
  const helpReadInput = {
    id: z
      .string()
      .describe(
        'Chapter id from help_list, e.g. 04-interaction-modes (no path, no extension).',
      ),
  };
  server.tool(
    'help_read',
    "Product help: read one DONNA documentation chapter by id (from help_list). Use to answer a question about the application itself, then reply in the user's language. Not the workspace wiki.",
    helpReadInput,
    READ_ONLY,
    (input) => loggedTool('help_read', input, helpRead),
  );
  const helpSearchInput = {
    query: z.string().min(2).describe('Natural-language question about DONNA or wikiLLM.'),
  };
  server.tool(
    'help_search',
    'Search the bundled DONNA/wikiLLM product documentation and return the most relevant chapters. Use for questions about the application itself, its interfaces, commands, configuration, agents, concurrency, or troubleshooting. Not the workspace wiki.',
    helpSearchInput,
    READ_ONLY,
    (input) => loggedTool('help_search', input, async ({ query }: { query: string }) => {
      const result = await searchHelpChapters(query);
      if (result.chapters.length === 0) {
        return textResult('No relevant product documentation chapter was found.');
      }
      return textResult(result.chapters
        .map((chapter) => `--- ${chapter.id} — ${chapter.title} ---\n${chapter.content}`)
        .join('\n\n'));
    }),
  );

  const profilePath = path.join(workspace.paths.internalDir, 'profile.md');

  const readProfile = async () => {
    const exists = await pathExists(profilePath);
    if (!exists) {
      return textResult(
        `No profile found at .wiki/profile.md.\nchars: 0\nmaxProfileChars: ${config.limits.maxProfileChars}`,
      );
    }
    const content = (await readFile(profilePath, 'utf8')).trim();
    return textResult(
      `${content}\n\n---\nchars: ${content.length}\nmaxProfileChars: ${config.limits.maxProfileChars}`,
    );
  };

  server.tool(
    'profile_read',
    'Read the workspace profile from .wiki/profile.md. Returns the full content, character count, and maxProfileChars limit.',
    {},
    READ_ONLY,
    () => loggedTool('profile_read', {}, readProfile),
  );

  const updateProfile = async ({
    content,
    confirm,
    dryRun,
  }: {
    content: string;
    confirm?: boolean;
    dryRun?: boolean;
  }) => {
    if (content.length > config.limits.maxProfileChars) {
      await appendAuditRecord(workspace, {
        tool: 'profile_update',
        target: '.wiki/profile.md',
        action: 'rejected_limit',
        contentChars: content.length,
        maxProfileChars: config.limits.maxProfileChars,
      });
      return textResult(
        JSON.stringify(
          {
            error: 'Profile exceeds maxProfileChars limit.',
            contentChars: content.length,
            maxProfileChars: config.limits.maxProfileChars,
            written: false,
          },
          null,
          2,
        ),
        { isError: true },
      );
    }
    const before = (await pathExists(profilePath))
      ? await readFile(profilePath, 'utf8')
      : '';
    const confirmed = confirm === true;
    const previewOnly = dryRun === true || !confirmed;
    const payload = createWritePreviewPayload({
      target: '.wiki/profile.md',
      before,
      after: content,
      confirmed,
      dryRun: dryRun === true,
      written: !previewOnly,
    });
    if (previewOnly) {
      await appendAuditRecord(workspace, {
        tool: 'profile_update',
        target: '.wiki/profile.md',
        action: dryRun === true ? 'dry_run' : 'preview_required',
        confirmed,
        contentChars: content.length,
        beforeSha256: payload.beforeSha256,
        afterSha256: payload.afterSha256,
      });
      return textResult(
        JSON.stringify(
          {
            ...payload,
            maxProfileChars: config.limits.maxProfileChars,
            message: 'Preview only. Re-run with confirm=true to write.',
          },
          null,
          2,
        ),
      );
    }
    await writeFile(profilePath, content, 'utf8');
    await appendAuditRecord(workspace, {
      tool: 'profile_update',
      target: '.wiki/profile.md',
      action: 'write',
      confirmed,
      contentChars: content.length,
      beforeSha256: payload.beforeSha256,
      afterSha256: payload.afterSha256,
    });
    console.error(`Profile updated: .wiki/profile.md`);
    return textResult(`Profile updated: .wiki/profile.md`);
  };

  server.tool(
    'profile_update',
    'Write the workspace profile to .wiki/profile.md. Returns a diff preview unless confirm=true; dryRun=true never writes; maxProfileChars is enforced.',
    {
      content: z.string().describe('Full Markdown content to write to .wiki/profile.md.'),
      confirm: z
        .boolean()
        .optional()
        .describe('Must be true to write. Omit or false returns a diff preview only.'),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          'When true, return the write preview and audit the attempt without writing.',
        ),
    },
    (input) => loggedTool('profile_update', input, updateProfile),
  );

  return server;
}
