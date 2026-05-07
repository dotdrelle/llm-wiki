import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceService } from './workspaceService.ts';
import { pathExists } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import type { AppConfig } from '../types.ts';

export function checkMcpAccessKey(config: AppConfig, providedKey: string | undefined): boolean {
  return config.mcp.accessKey === undefined || providedKey === config.mcp.accessKey;
}

export async function createWikiMcpServer(config: AppConfig): Promise<McpServer> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();

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
      const absolutePath = resolveInside(
        workspace.paths.wikiDir,
        pagePath.replace(/^wiki\//, ''),
      );
      if (!(await pathExists(absolutePath))) {
        return { content: [{ type: 'text', text: `Page not found: ${pagePath}` }], isError: true };
      }
      const content = await readFile(absolutePath, 'utf8');
      return { content: [{ type: 'text', text: content }] };
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
      const absolutePath = resolveInside(workspace.paths.rootDir, sourcePath);
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
    },
  );

  return server;
}
