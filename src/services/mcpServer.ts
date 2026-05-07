import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceService } from './workspaceService.ts';
import { RetrievalService } from './retrievalService.ts';
import { pathExists } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import type { AppConfig } from '../types.ts';

export const WIKI_MCP_TOOLS = [
  {
    name: 'list_wiki_pages',
    description: 'List all pages in wiki/ with their type.',
  },
  {
    name: 'read_wiki_page',
    description: 'Read a wiki page by relative path, for example wiki/concepts/foo.md.',
  },
  {
    name: 'write_wiki_page',
    description: 'Create or update a wiki/* markdown page.',
  },
  {
    name: 'list_sources',
    description: 'List ingested source documents in raw/ingested/.',
  },
  {
    name: 'read_source',
    description: 'Read one ingested source document by relative path.',
  },
  {
    name: 'search_wiki_context',
    description: 'Search wiki pages and ingested sources for relevant passages.',
  },
  {
    name: 'read_many',
    description: 'Read several wiki/ or raw/ingested/ files in one call.',
  },
] as const;

export function checkMcpAccessKey(config: AppConfig, providedKey: string | undefined): boolean {
  return config.mcp.accessKey === undefined || providedKey === config.mcp.accessKey;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n[truncated]`;
}

function extractSourceCitations(content: string): string[] {
  const citations = new Set<string>();
  for (const match of content.matchAll(/\[src:\s*([^\]\n]+?)\s*\]/g)) {
    citations.add(match[1].trim());
  }
  return [...citations];
}

function resolveReadableWorkspacePath(workspace: WorkspaceService, requestedPath: string): string {
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

  server.tool('list_wiki_pages', 'List all pages in wiki/', {}, async () => {
    const pages = await workspace.listWikiPages();
    const items = pages.map((p) => `${p.relativePath} [${p.type}]`);
    return { content: [{ type: 'text', text: items.join('\n') }] };
  });

  server.tool(
    'read_wiki_page',
    'Read the content of a wiki page by its relative path (e.g. wiki/concepts/foo.md)',
    { path: z.string().describe('Relative path from workspace root, e.g. wiki/concepts/foo.md') },
    async ({ path: pagePath }) => {
      try {
        const absolutePath = resolveReadableWorkspacePath(workspace, pagePath);
        const relativeToWiki = path.relative(workspace.paths.wikiDir, absolutePath);
        if (relativeToWiki.startsWith('..') || path.isAbsolute(relativeToWiki)) {
          return {
            content: [{ type: 'text', text: 'Access denied: path must be under wiki/.' }],
            isError: true,
          };
        }
        if (!(await pathExists(absolutePath))) {
          return { content: [{ type: 'text', text: `Page not found: ${pagePath}` }], isError: true };
        }
        const content = await readFile(absolutePath, 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'write_wiki_page',
    'Write or update a wiki page. Only wiki/* paths are allowed. Creates the page if it does not exist.',
    {
      path: z.string().describe('Relative path from workspace root, must start with wiki/'),
      content: z.string().describe('Full markdown content to write'),
    },
    async ({ path: pagePath, content }) => {
      await workspace.applyWikiOperations([{ type: 'update', path: pagePath, content }]);
      return { content: [{ type: 'text', text: `Written: ${pagePath}` }] };
    },
  );

  server.tool(
    'list_sources',
    'List ingested source documents in raw/ingested/',
    {},
    async () => {
      const pages = await workspace.listIngestedSourcePages();
      if (pages.length === 0) {
        return { content: [{ type: 'text', text: 'No ingested sources found.' }] };
      }
      const items = pages.map((p) => p.relativePath);
      return { content: [{ type: 'text', text: items.join('\n') }] };
    },
  );

  server.tool(
    'read_source',
    'Read the content of an ingested source document',
    { path: z.string().describe('Relative path from workspace root, e.g. raw/ingested/doc.md') },
    async ({ path: sourcePath }) => {
      try {
        const absolutePath = resolveReadableWorkspacePath(workspace, sourcePath);
        const relative = path.relative(workspace.paths.rawIngestedDir, absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return {
            content: [{ type: 'text', text: 'Access denied: path must be under raw/ingested/' }],
            isError: true,
          };
        }
        if (!(await pathExists(absolutePath))) {
          return { content: [{ type: 'text', text: `Source not found: ${sourcePath}` }], isError: true };
        }
        const content = await readFile(absolutePath, 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'search_wiki_context',
    'Search wiki pages and ingested sources for documents/passages relevant to a question. Returns context candidates only; the client should read selected paths and answer itself.',
    {
      question: z.string().min(1).describe('Question or topic to search for.'),
      maxResults: z.number().int().min(1).max(20).optional().describe('Maximum results to return.'),
      includeRaw: z
        .boolean()
        .optional()
        .describe('Whether to include raw/ingested source files in addition to wiki pages. Default true.'),
      maxExcerptChars: z
        .number()
        .int()
        .min(200)
        .max(6000)
        .optional()
        .describe('Maximum excerpt size per result.'),
    },
    async ({ question, maxResults, includeRaw, maxExcerptChars }) => {
      const results = await retrieval.search(question, {
        limit: maxResults ?? config.retrieval.maxContextFiles,
        includeRaw: includeRaw ?? true,
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
          };
        }),
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.tool(
    'read_many',
    'Read multiple wiki/ or raw/ingested/ markdown files in one call.',
    {
      paths: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe('Relative paths under wiki/ or raw/ingested/.'),
      maxCharsPerFile: z
        .number()
        .int()
        .min(500)
        .max(50000)
        .optional()
        .describe('Maximum characters returned per file.'),
    },
    async ({ paths, maxCharsPerFile }) => {
      const limit = maxCharsPerFile ?? 20000;
      const documents = [];
      for (const requestedPath of paths) {
        try {
          const absolutePath = resolveReadableWorkspacePath(workspace, requestedPath);
          if (!(await pathExists(absolutePath))) {
            documents.push({ path: requestedPath, error: 'Not found' });
            continue;
          }
          documents.push({
            path: requestedPath,
            content: truncateText(await readFile(absolutePath, 'utf8'), limit),
          });
        } catch (error) {
          documents.push({
            path: requestedPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ documents }, null, 2) }] };
    },
  );

  return server;
}
