import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig } from '../src/types.ts';

// A source locked from the Pending panel is `a.md.lock`: every ingest path —
// Donna, headless, maintenance — globs `*.md`, so it is skipped without any of
// them knowing about locks; an explicit request for it is refused by name.
let root: string;
let workspace: WorkspaceService;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pending-lock-'));
  await mkdir(path.join(root, 'raw/untracked/lot'), { recursive: true });
  await writeFile(path.join(root, 'raw/untracked/lot/open.md'), '# open\n', 'utf8');
  await writeFile(path.join(root, 'raw/untracked/lot/frozen.md.lock'), '# frozen\n', 'utf8');
  workspace = new WorkspaceService({ wikiRoot: root } as AppConfig);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pending source lock', () => {
  it('leaves a locked source out of a full ingest', async () => {
    const inputs = (await workspace.resolveSourceInputs([])).map((file) => path.relative(root, file));
    expect(inputs).toEqual(['raw/untracked/lot/open.md']);
  });

  it('refuses an explicit locked source by name, under either spelling', async () => {
    await expect(workspace.resolveSourceInputs(['lot/frozen.md.lock'])).rejects.toThrow(/locked out of ingestion/);
    await expect(workspace.resolveSourceInputs(['raw/untracked/lot/frozen.md'])).rejects.toThrow(/locked out of ingestion/);
    await expect(workspace.resolveSourceInputs(['lot/missing.md'])).rejects.toThrow(/not found/);
  });
});
