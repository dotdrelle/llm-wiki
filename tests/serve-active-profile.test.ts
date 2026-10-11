import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createActiveProfileFollower } from '../src/serve/activeProfile.ts';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe('createActiveProfileFollower', () => {
  it('mirrors the profile another surface made active, once', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'active-profile-'));
    await writeFile(path.join(dir, '.wikirc.yaml'), 'llm: {}\n');
    await writeFile(path.join(dir, '.wikirc.yaml.fast'), 'llm: {}\n');
    let current = path.join(dir, '.wikirc.yaml');
    const mirrored: string[] = [];
    const follow = createActiveProfileFollower({
      rootDir: dir,
      currentConfigPath: () => current,
      mirror: async (fileName) => { mirrored.push(fileName); current = path.join(dir, fileName); },
      intervalMs: 0,
      log: () => {},
    });
    await follow();
    expect(mirrored).toEqual([]);
    await mkdir(path.join(dir, '.wiki'), { recursive: true });
    await writeFile(path.join(dir, '.wiki', 'active-profile.json'), JSON.stringify({ profile: 'fast' }));
    await follow();
    await follow();
    expect(mirrored).toEqual(['.wikirc.yaml.fast']);
  });

  it('follows the recorded file when two profiles share a name', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'active-profile-'));
    await writeFile(path.join(dir, '.wikirc.yaml'), 'llm: {}\n');
    await writeFile(path.join(dir, '.wikirc.yaml.default'), 'llm: {}\n');
    await mkdir(path.join(dir, '.wiki'), { recursive: true });
    await writeFile(path.join(dir, '.wiki', 'active-profile.json'), JSON.stringify({ profile: 'default', fileName: '.wikirc.yaml.default' }));
    const mirrored: string[] = [];
    const follow = createActiveProfileFollower({ rootDir: dir, currentConfigPath: () => path.join(dir, '.wikirc.yaml'), mirror: async (f) => { mirrored.push(f); }, intervalMs: 0, log: () => {} });
    await follow();
    expect(mirrored).toEqual(['.wikirc.yaml.default']);
  });

  it('ignores a persisted profile whose file is gone', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'active-profile-'));
    await mkdir(path.join(dir, '.wiki'), { recursive: true });
    await writeFile(path.join(dir, '.wiki', 'active-profile.json'), JSON.stringify({ profile: 'gone' }));
    const mirrored: string[] = [];
    const follow = createActiveProfileFollower({ rootDir: dir, currentConfigPath: () => undefined, mirror: async (f) => { mirrored.push(f); }, intervalMs: 0, log: () => {} });
    await follow();
    expect(mirrored).toEqual([]);
  });
});
