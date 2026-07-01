import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types.ts';
import { loadConfig } from '../src/config/loadConfig.ts';
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
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
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
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

describe('workspace safety', () => {
  it('scaffolds reranking disabled by default', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-init-'));
    const config = createConfig(root);
    const workspace = new WorkspaceService(config);

    await workspace.initWorkspace({});

    const initializedConfig = await loadConfig(root);
    expect(initializedConfig.retrieval.vector.rerankEnabled).toBe(false);
    await expect(readFile(path.join(root, '.wiki', 'profile.md'), 'utf8')).resolves.toContain(
      '# Workspace Profile',
    );
  });

  it('loads the full workspace profile when it is within the character limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-profile-'));
    const workspace = new WorkspaceService(createConfig(root));
    await mkdir(path.join(root, '.wiki'), { recursive: true });
    await writeFile(
      path.join(root, '.wiki', 'profile.md'),
      '# Workspace Profile\n\n## User Preferences\n\n- Prefers concise French answers.\n',
      'utf8',
    );

    const section = await workspace.loadProfileSection(4000);

    expect(section).toContain('The workspace profile is stored in `.wiki/profile.md`');
    expect(section).toContain('- Prefers concise French answers.');
  });

  it('loads only the profile summary when the profile exceeds the character limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-profile-'));
    const workspace = new WorkspaceService(createConfig(root));
    await mkdir(path.join(root, '.wiki'), { recursive: true });
    await writeFile(
      path.join(root, '.wiki', 'profile.md'),
      `# Workspace Profile\n\n## Summary\n\nConcise durable profile.\n\n## Notes\n\n${'Long note. '.repeat(100)}`,
      'utf8',
    );

    const section = await workspace.loadProfileSection(100);

    expect(section).toContain('## Summary\n\nConcise durable profile.');
    expect(section).not.toContain('Long note.');
  });

  it('warns when a profile exceeds the character limit without a summary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-profile-'));
    const workspace = new WorkspaceService(createConfig(root));
    await mkdir(path.join(root, '.wiki'), { recursive: true });
    await writeFile(
      path.join(root, '.wiki', 'profile.md'),
      `# Workspace Profile\n\n## Notes\n\n${'Long note. '.repeat(100)}`,
      'utf8',
    );

    const section = await workspace.loadProfileSection(100);

    expect(section).toContain('Profile exceeds maxProfileChars limit');
    expect(section).toContain('profile_update tool');
    expect(section).not.toContain('Long note.');
  });

  it('installs a workspace skill by backing up and replacing skill-owned paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-skill-'));
    const skillRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-skill-'));
    const workspace = new WorkspaceService(createConfig(root));
    await workspace.initWorkspace({});
    await writeFile(path.join(root, 'templates', 'old.md'), '# Old\n', 'utf8');

    await mkdir(path.join(skillRoot, 'templates'), { recursive: true });
    await mkdir(path.join(skillRoot, 'build-context', 'rules'), { recursive: true });
    await mkdir(path.join(skillRoot, '.wiki', 'skills'), { recursive: true });
    await writeFile(
      path.join(skillRoot, 'skill.yaml'),
      'name: test-skill\nversion: 1.2.3\n',
      'utf8',
    );
    await writeFile(path.join(skillRoot, 'CLAUDE.md'), '# Test Skill\n', 'utf8');
    await writeFile(
      path.join(skillRoot, '.wiki', 'system-prompt.md'),
      'Use the test skill.\n',
      'utf8',
    );
    await writeFile(path.join(skillRoot, 'templates', 'note.md'), '# Note\n', 'utf8');
    await writeFile(
      path.join(skillRoot, 'build-context', 'rules', 'style.md'),
      '# Style\n',
      'utf8',
    );
    await writeFile(path.join(skillRoot, '.wiki', 'skills', 'status.md'), '# Status\n', 'utf8');

    const result = await workspace.addSkill(skillRoot);

    expect(result.name).toBe('test-skill');
    expect(result.version).toBe('1.2.3');
    await expect(readFile(path.join(root, 'templates', 'note.md'), 'utf8')).resolves.toBe(
      '# Note\n',
    );
    await expect(readFile(path.join(root, 'templates', 'old.md'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(path.join(root, result.backupDir, 'templates', 'old.md'), 'utf8'),
    ).resolves.toBe('# Old\n');
    await expect(
      readFile(path.join(root, '.wiki', 'skill-install.json'), 'utf8'),
    ).resolves.toContain('"name": "test-skill"');
  });

  it('rejects skill packages with paths outside the supported workspace layout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-skill-'));
    const skillRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-skill-'));
    const workspace = new WorkspaceService(createConfig(root));
    await workspace.initWorkspace({});

    await mkdir(path.join(skillRoot, 'templates'), { recursive: true });
    await mkdir(path.join(skillRoot, 'build-context'), { recursive: true });
    await mkdir(path.join(skillRoot, '.wiki', 'skills'), { recursive: true });
    await mkdir(path.join(skillRoot, 'wiki'), { recursive: true });
    await writeFile(path.join(skillRoot, 'skill.yaml'), 'name: bad\n', 'utf8');
    await writeFile(path.join(skillRoot, 'templates', 'note.md'), '# Note\n', 'utf8');
    await writeFile(path.join(skillRoot, 'build-context', 'rules.md'), '# Rules\n', 'utf8');
    await writeFile(path.join(skillRoot, '.wiki', 'skills', 'status.md'), '# Status\n', 'utf8');
    await writeFile(path.join(skillRoot, 'wiki', 'index.md'), '# Bad\n', 'utf8');

    await expect(workspace.addSkill(skillRoot)).rejects.toThrow(/unexpected path/i);
  });

  it('resolves bare filenames to existing wiki paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'wiki', 'sources'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'wiki', 'sources', 'accompagnement-ap-acme.md'),
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
        path: 'accompagnement-ap-acme.md',
        content: '# Updated\n',
      },
    ]);

    expect(operations.map((operation) => operation.path)).toEqual([
      'wiki/index.md',
      'wiki/sources/accompagnement-ap-acme.md',
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

  it('rolls back already written wiki files when an atomic apply fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Original Index\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'blocked'), 'not a directory\n', 'utf8');
    const workspace = new WorkspaceService(createConfig(root));

    await expect(
      workspace.applyWikiOperations([
        {
          type: 'update',
          path: 'wiki/index.md',
          content: '# Mutated Index\n',
        },
        {
          type: 'create',
          path: 'wiki/blocked/page.md',
          content: '# Cannot write\n',
        },
      ]),
    ).rejects.toThrow();

    await expect(readFile(path.join(root, 'wiki', 'index.md'), 'utf8')).resolves.toBe(
      '# Original Index\n',
    );
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
      'Programme exemple meteo',
      'Programme exemple meteo',
      'Volet fonctionnel AP Alpha',
    );
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = path.join(
      sourceDir,
      'Synthese du positionnement des directions.md',
    );
    await writeFile(sourcePath, '# Synthèse\n\nContenu.\n', 'utf8');
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    expect(source.archiveCitationPath).toBe(
      'raw/ingested/programme-exemple-meteo/volet-fonctionnel-ap-alpha/synthese-du-positionnement-des-directions.md',
    );
  });

  it('falls back to Latin-1 when a source file is not valid UTF-8', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
    const sourcePath = path.join(root, 'raw', 'untracked', 'modalites.md');
    await writeFile(
      sourcePath,
      Buffer.from([
        ...Buffer.from('# Modalit'),
        0xe9,
        ...Buffer.from('s\n\nContenu r'),
        0xe9,
        ...Buffer.from('sum'),
        0xe9,
        ...Buffer.from('.\n'),
      ]),
    );
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    expect(source.detectedEncoding).toBe('latin-1');
    expect(source.rawContent).toContain('# Modalités');
    expect(source.body).toContain('Contenu résumé.');
  });

  it('does not treat an archived source with a different byte size as unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-workspace-'));
    await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    const sourcePath = path.join(root, 'raw', 'untracked', 'note.md');
    await writeFile(sourcePath, '# Note\n\nSame content.\n', 'utf8');
    await writeFile(
      path.join(root, 'raw', 'ingested', 'note.md'),
      '# Note\n\nDifferent.\n',
      'utf8',
    );
    const workspace = new WorkspaceService(createConfig(root));

    const source = await workspace.readSourceDocument(sourcePath);

    await expect(workspace.isSourceUnchangedSinceIngest(source)).resolves.toBe(false);
  });
});
