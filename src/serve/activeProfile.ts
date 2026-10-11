import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../utils/fs.ts';

/*
 The active .wikirc profile is the workspace's (`.wiki/active-profile.json`,
 written by every switch: serve's picker through the runtime, the ShellUI's
 `/config use`). Serve follows it so a switch made in the ShellUI reaches its
 badge, its retrieval and its fallback chat — read at most every `intervalMs`.
 A profile that cannot be loaded keeps the current config and is logged.
 */
export function createActiveProfileFollower(deps: {
  rootDir: string;
  currentConfigPath: () => string | undefined;
  mirror: (fileName: string) => Promise<unknown>;
  intervalMs?: number;
  log?: (message: string) => void;
}): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? 2000;
  const log = deps.log ?? ((message: string) => console.error(message));
  let checkedAt = 0;
  return async () => {
    const now = Date.now();
    if (now - checkedAt < intervalMs) return;
    checkedAt = now;
    let profile: string | null = null;
    try {
      const record = JSON.parse(await readFile(path.join(deps.rootDir, '.wiki', 'active-profile.json'), 'utf8')) as { profile?: unknown };
      profile = typeof record.profile === 'string' && record.profile.trim() ? record.profile.trim() : null;
    } catch {
      return;
    }
    if (!profile) return;
    const fileName = profile === 'default' ? '.wikirc.yaml' : `.wikirc.yaml.${profile}`;
    const current = deps.currentConfigPath();
    if (current && path.resolve(deps.rootDir, fileName) === path.resolve(current)) return;
    if (!(await pathExists(path.join(deps.rootDir, fileName)))) return;
    try {
      await deps.mirror(fileName);
      log(`[serve] config: following the workspace's active profile "${profile}"`);
    } catch (err) {
      log(`[serve] config: active profile "${profile}" could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
