import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceStatusPayload } from '../src/services/mcpServer.ts';
import type { WorkspaceService } from '../src/services/workspaceService.ts';

describe('wiki_workspace_status', () => {
  it('returns one canonical inventory with concrete relative paths', async () => {
    const root = path.resolve('/workspace');
    const workspace = {
      paths: { rootDir: root },
      listUntrackedSourcePaths: async () => [
        path.join(root, 'raw/untracked/a.md'),
        path.join(root, 'raw/untracked/nested/b.md'),
      ],
      listIngestedSourcePages: async () => [{ relativePath: 'raw/ingested/old.md' }],
      listWikiPages: async () => [{ relativePath: 'wiki/index.md' }],
      listTemplatePaths: async () => [path.join(root, 'templates/report.md')],
      readBuildContext: async () => ({ fileCount: 2, truncated: false }),
      listDeliverablePaths: async () => [path.join(root, 'deliverables/report.md')],
    } as unknown as WorkspaceService;

    await expect(workspaceStatusPayload(workspace)).resolves.toEqual({
      workspace: { root },
      pendingSources: {
        count: 2,
        files: ['raw/untracked/a.md', 'raw/untracked/nested/b.md'],
      },
      ingestedSources: { count: 1, files: ['raw/ingested/old.md'] },
      wikiPages: { count: 1, files: ['wiki/index.md'] },
      templates: { count: 1, files: ['templates/report.md'] },
      buildContext: { fileCount: 2, truncated: false },
      deliverables: { count: 1, files: ['deliverables/report.md'] },
    });
  });
});
