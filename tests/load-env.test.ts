import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspaceEnv } from '../src/config/loadEnv.ts';

const TEST_KEY = 'LLM_WIKI_TEST_ENV_VALUE';

describe('workspace .env loading', () => {
  afterEach(() => {
    delete process.env[TEST_KEY];
    delete process.env.WIKI_WORKSPACE;
    delete process.env.WIKI_WORKSPACE_PATH;
    delete process.env.WIKI_ENV_FILE;
  });

  it('loads .env from the current workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-env-'));
    await writeFile(path.join(root, '.env'), `${TEST_KEY}=workspace-value\n`);

    await loadWorkspaceEnv(root);

    expect(process.env[TEST_KEY]).toBe('workspace-value');
  });

  it('finds the workspace .env from a nested directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-env-'));
    const nested = path.join(root, 'wiki', 'concepts');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, '.env'), `${TEST_KEY}=root-value\n`);

    await loadWorkspaceEnv(nested);

    expect(process.env[TEST_KEY]).toBe('root-value');
  });

  it('loads .env from an explicitly selected workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-env-'));
    const workspace = path.join(root, 'selected');
    await mkdir(workspace);
    await writeFile(path.join(workspace, '.env'), `${TEST_KEY}=selected-value\n`);
    process.env.WIKI_WORKSPACE = workspace;

    await loadWorkspaceEnv(root);

    expect(process.env[TEST_KEY]).toBe('selected-value');
  });

  it('loads an explicitly selected env file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-env-'));
    await writeFile(path.join(root, 'manager.env'), `${TEST_KEY}=explicit-value\n`);
    process.env.WIKI_ENV_FILE = 'manager.env';

    await loadWorkspaceEnv(root);

    expect(process.env[TEST_KEY]).toBe('explicit-value');
  });

  it('does not overwrite variables exported by the shell', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-env-'));
    await writeFile(path.join(root, '.env'), `${TEST_KEY}=workspace-value\n`);
    process.env[TEST_KEY] = 'shell-value';

    await loadWorkspaceEnv(root);

    expect(process.env[TEST_KEY]).toBe('shell-value');
  });
});
