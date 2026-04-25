import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    build: {
      refreshOnIngest: true,
        slotBatchSize: 5,
    },
    retrieval: {
      maxContextFiles: 8,
    },
  };
}

describe('workspace safety', () => {
  it('resolves bare filenames to existing wiki paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'wiki', 'sources', 'accompagnement-ap-juno.md'),
      '# Accompagnement\n',
      'utf8',
    );
    const workspace = new WorkspaceService(createConfig(root));

    const operations = await workspace.normalizeWikiOperations([
      {
        type: 'update',
        path: 'index.md',
        content: '# New Index\n',
      },
      {
        type: 'update',
        path: 'accompagnement-ap-juno.md',
        content: '# Updated\n',
      },
    ]);

    expect(operations.map((operation) => operation.path)).toEqual([
      'wiki/index.md',
      'wiki/sources/accompagnement-ap-juno.md',
    ]);
  });

  it('rejects ingest operations outside wiki/', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    const workspace = new WorkspaceService(createConfig(root));

    await expect(
      workspace.applyWikiOperations([
        {
          type: 'create',
          path: 'wiki/../escape.md',
          content: 'bad',
        },
      ]),
    ).rejects.toThrow(/escapes workspace root/i);
  });
});
