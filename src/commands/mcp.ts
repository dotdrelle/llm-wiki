import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../types.ts';
import { checkMcpAccessKey, createWikiMcpServer } from '../services/mcpServer.ts';

export default async function mcpCmd(config: AppConfig): Promise<void> {
  const providedKey = process.env.WIKI_MCP_KEY ?? process.env.WIKI_MCP_ACCESS_KEY;
  if (!checkMcpAccessKey(config, providedKey)) {
    process.stderr.write('wiki mcp: invalid or missing WIKI_MCP_ACCESS_KEY\n');
    process.exit(1);
  }

  const server = await createWikiMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
