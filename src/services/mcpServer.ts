import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WorkspaceService } from './workspaceService.ts';
import { RetrievalService } from './retrievalService.ts';
import { pathExists } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import { extractSourceCitations } from '../utils/markdown.ts';
import type { AppConfig } from '../types.ts';

export const WIKI_MCP_TOOLS = [
  {
    name: 'wiki_list_pages',
    description:
      'List llm-wiki markdown pages under wiki/. Use this only for the llm-wiki knowledge base, not AgentCME runtime configuration.',
  },
  {
    name: 'wiki_read_page',
    description:
      'Read one llm-wiki markdown page under wiki/ by relative path. Use this for wiki content, not AgentCME status or Confluence export settings.',
  },
  {
    name: 'wiki_write_page',
    description:
      'Create or update one llm-wiki markdown page under wiki/. Use this only for wiki content edits.',
  },
  {
    name: 'wiki_list_ingested_sources',
    description:
      'List source documents already ingested into llm-wiki under raw/ingested/. Do not use this for AgentCME configured export sources.',
  },
  {
    name: 'wiki_read_ingested_source',
    description:
      'Read one llm-wiki ingested source document under raw/ingested/. Do not use this for AgentCME configuration.',
  },
  {
    name: 'wiki_search_context',
    description:
      'First step for question answering over llm-wiki. Search wiki/ and raw/ingested/ and return ranked candidate paths with excerpts and citations only; this does not read full files and intentionally excludes wiki/answers/*. Use maxResults as needed, then call wiki_read_many with the returned paths.',
  },
  {
    name: 'wiki_read_many',
    description:
      'Second step for question answering over llm-wiki. Read selected wiki/ or raw/ingested/ files in batches after wiki_search_context. Pass all chosen paths, read offset 0 limit 5 by default, then continue with nextOffset until enough context is loaded.',
  },
] as const;

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

function resolveReadableWorkspacePath(
  workspace: WorkspaceService,
  requestedPath: string,
): string {
  const normalizedPath = requestedPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const absolutePath = resolveInside(workspace.paths.rootDir, normalizedPath);
  const relativeToRoot = path.relative(workspace.paths.rootDir, absolutePath);
  const relativeToWiki = path.relative(workspace.paths.wikiDir, absolutePath);
  const relativeToIngested = path.relative(workspace.paths.rawIngestedDir, absolutePath);
  const underRoot = !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot);
  const underWiki = !relativeToWiki.startsWith('..') && !path.isAbsolute(relativeToWiki);
  const underIngested =
    !relativeToIngested.startsWith('..') && !path.isAbsolute(relativeToIngested);

  if (!underRoot || (!underWiki && !underIngested)) {
    throw new Error('Access denied: path must be under wiki/ or raw/ingested/.');
  }

  return absolutePath;
}

export async function createWikiMcpServer(config: AppConfig): Promise<McpServer> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const retrieval = new RetrievalService(workspace, config);

  const server = new McpServer({
    name: 'llm-wiki',
    version: '1.0.0',
  });

  const listWikiPages = async () => {
    const pages = await workspace.listWikiPages();
    const items = pages.map((p) => `${p.relativePath} [${p.type}]`);
    return textResult(items.join('\n'));
  };

  const readWikiPage = async ({ path: pagePath }: { path: string }) => {
    try {
      const absolutePath = resolveReadableWorkspacePath(workspace, pagePath);
      const relativeToWiki = path.relative(workspace.paths.wikiDir, absolutePath);
      if (relativeToWiki.startsWith('..') || path.isAbsolute(relativeToWiki)) {
        return textResult('Access denied: path must be under wiki/.', { isError: true });
      }
      if (!(await pathExists(absolutePath))) {
        return textResult(`Page not found: ${pagePath}`, { isError: true });
      }
      const content = await readFile(absolutePath, 'utf8');
      return textResult(content);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), {
        isError: true,
      });
    }
  };

  const writeWikiPage = async ({
    path: pagePath,
    content,
  }: {
    path: string;
    content: string;
  }) => {
    await workspace.applyWikiOperations([{ type: 'update', path: pagePath, content }]);
    return textResult(`Written: ${pagePath}`);
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
      .optional()
      .describe(
        'Maximum ranked candidates to return. There is no MCP hard cap; omit to use retrieval.maxContextFiles from .wikirc.yaml.',
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
      limit: maxResults ?? config.retrieval.maxContextFiles,
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

  const readManyInput = {
    paths: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'Ordered relative paths under wiki/ or raw/ingested/, usually copied from wiki_search_context results. Pass the full selected path list and page through it with offset and limit.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Zero-based offset into paths. Default 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Maximum number of files to read from paths starting at offset. Default 5; use 5 unless the client has enough context for larger batches.',
      ),
    maxCharsPerFile: z
      .number()
      .int()
      .min(500)
      .max(config.retrieval.maxSourceChars)
      .optional()
      .describe(
        `Maximum characters returned per file. Defaults to and is capped by retrieval.maxSourceChars from .wikirc.yaml (${config.retrieval.maxSourceChars}).`,
      ),
  };
  const readMany = async ({
    paths,
    offset,
    limit,
    maxCharsPerFile,
  }: {
    paths: string[];
    offset?: number;
    limit?: number;
    maxCharsPerFile?: number;
  }) => {
    const start = offset ?? 0;
    const batchLimit = limit ?? 5;
    const selectedPaths = paths.slice(start, start + batchLimit);
    const charsPerFile = Math.min(
      maxCharsPerFile ?? config.retrieval.maxSourceChars,
      config.retrieval.maxSourceChars,
    );
    const documents = [];
    for (const requestedPath of selectedPaths) {
      try {
        const absolutePath = resolveReadableWorkspacePath(workspace, requestedPath);
        if (!(await pathExists(absolutePath))) {
          documents.push({ path: requestedPath, error: 'Not found' });
          continue;
        }
        documents.push({
          path: requestedPath,
          content: truncateText(await readFile(absolutePath, 'utf8'), charsPerFile),
        });
      } catch (error) {
        documents.push({
          path: requestedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return textResult(
      JSON.stringify(
        {
          offset: start,
          limit: batchLimit,
          count: documents.length,
          totalPaths: paths.length,
          nextOffset:
            start + documents.length < paths.length ? start + documents.length : null,
          maxCharsPerFile: charsPerFile,
          documents,
        },
        null,
        2,
      ),
    );
  };

  server.tool(
    'wiki_list_pages',
    'List llm-wiki markdown pages under wiki/. Use this only for the llm-wiki knowledge base, not AgentCME runtime configuration.',
    {},
    (input) => loggedTool('wiki_list_pages', input, listWikiPages),
  );

  const readWikiPageInput = {
    path: z
      .string()
      .describe('Relative path from workspace root, e.g. wiki/concepts/foo.md'),
  };
  server.tool(
    'wiki_read_page',
    'Read one llm-wiki markdown page under wiki/ by relative path. Use this for wiki content, not AgentCME status or Confluence export settings.',
    readWikiPageInput,
    (input) => loggedTool('wiki_read_page', input, readWikiPage),
  );

  const writeWikiPageInput = {
    path: z.string().describe('Relative path from workspace root, must start with wiki/'),
    content: z.string().describe('Full markdown content to write'),
  };
  server.tool(
    'wiki_write_page',
    'Create or update one llm-wiki markdown page under wiki/. Use this only for wiki content edits.',
    writeWikiPageInput,
    (input) => loggedTool('wiki_write_page', input, writeWikiPage),
  );

  server.tool(
    'wiki_list_ingested_sources',
    'List source documents already ingested into llm-wiki under raw/ingested/. Do not use this for AgentCME configured export sources.',
    {},
    (input) => loggedTool('wiki_list_ingested_sources', input, listIngestedSources),
  );

  const readSourceInput = {
    path: z
      .string()
      .describe('Relative path from workspace root, e.g. raw/ingested/doc.md'),
  };
  server.tool(
    'wiki_read_ingested_source',
    'Read one llm-wiki ingested source document under raw/ingested/. Do not use this for AgentCME configuration.',
    readSourceInput,
    (input) => loggedTool('wiki_read_ingested_source', input, readIngestedSource),
  );

  server.tool(
    'wiki_search_context',
    'First step for question answering over llm-wiki. Search wiki/ and raw/ingested/ and return ranked candidate paths with excerpts and citations only; this does not read full files and intentionally excludes wiki/answers/*. Use maxResults as needed, then call wiki_read_many with the returned paths.',
    searchWikiContextInput,
    (input) => loggedTool('wiki_search_context', input, searchWikiContext),
  );

  server.tool(
    'wiki_read_many',
    'Second step for question answering over llm-wiki. Read selected wiki/ or raw/ingested/ files in batches after wiki_search_context. Pass all chosen paths, read offset 0 limit 5 by default, then continue with nextOffset until enough context is loaded.',
    readManyInput,
    (input) => loggedTool('wiki_read_many', input, readMany),
  );

  return server;
}
