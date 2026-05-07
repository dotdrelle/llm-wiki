import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    language: 'fr',
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
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
    },
    mcp: {},
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

  it('limits build-context content with maxBuildContextChars', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'build-context'), { recursive: true });
    await writeFile(
      path.join(root, 'build-context', 'rules.md'),
      `# Rules\n\n${'A'.repeat(2000)}`,
      'utf8',
    );

    const config = createConfig(root);
    config.build.maxBuildContextChars = 1000;
    const workspace = new WorkspaceService(config);

    const buildContext = await workspace.readBuildContext();

    expect(buildContext.truncated).toBe(true);
    expect(buildContext.fileCount).toBe(1);
    expect(buildContext.content.length).toBeLessThanOrEqual(1000);
    expect(buildContext.rawTotalChars).toBeGreaterThan(1000);
    expect(buildContext.content).toContain('## build-context/rules.md');
  });

  it('detects unchanged ingested sources by matching path, byte size, and content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    const sourcePath = path.join(root, 'raw', 'untracked', 'note.md');
    await writeFile(sourcePath, '# Note\n\nSame content.\n', 'utf8');
    await writeFile(
      path.join(root, 'raw', 'ingested', 'note.md'),
      '# Note\n\nSame content.\n',
      'utf8',
    );
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    await expect(workspace.isSourceUnchangedSinceIngest(source)).resolves.toBe(true);
  });

  it('slugifies archived source paths and collapses duplicate confluence directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    const sourceDir = path.join(
      root,
      'raw',
      'untracked',
      'Jouvence de la chaîne de prévision production outre-mer',
      'Jouvence de la chaîne de prévision production outre-mer',
      'Volet fonctionnel AP JUNO',
    );
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = path.join(
      sourceDir,
      'Synthèse du positionnement des DIROM et du SRSPM.md',
    );
    await writeFile(sourcePath, '# Synthèse\n\nContenu.\n', 'utf8');
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    expect(source.archiveCitationPath).toBe(
      'raw/ingested/jouvence-de-la-chaine-de-prevision-production-outre-mer/volet-fonctionnel-ap-juno/synthese-du-positionnement-des-dirom-et-du-srspm.md',
    );
  });

  it('does not treat an archived source with a different byte size as unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    const sourcePath = path.join(root, 'raw', 'untracked', 'note.md');
    await writeFile(sourcePath, '# Note\n\nSame content.\n', 'utf8');
    await writeFile(path.join(root, 'raw', 'ingested', 'note.md'), '# Note\n\nDifferent.\n', 'utf8');
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    await expect(workspace.isSourceUnchangedSinceIngest(source)).resolves.toBe(false);
  });
});
