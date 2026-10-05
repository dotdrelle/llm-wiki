import { readFile, realpath, mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { hashText } from '../utils/hash.ts';
import { safeWriteFile, withFileLock } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';

export async function outputSnapshot(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Cooperating writers share this lock. External editors are detected by readback,
 * but cannot be given a filesystem-wide compare-and-swap guarantee. */
export async function publishOutput<T>(root: string, file: string, expected: string | null, publish: () => Promise<T>): Promise<T> {
  const relative = path.relative(root, file);
  const confined = resolveInside(root, relative);
  await mkdir(path.dirname(confined), { recursive: true });
  const canonicalRoot = await realpath(root);
  const canonicalParent = await realpath(path.dirname(confined));
  if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(canonicalRoot + path.sep)) throw new Error('output_path_escapes_workspace');
  // Refuse a symlink target, including an existing target outside the workspace.
  try { if (await realpath(confined) !== path.join(canonicalParent, path.basename(confined))) throw new Error('output_symlink_refused'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return withFileLock(path.join(root, '.wiki', 'output-locks', hashText(relative) + '.lock'), async () => {
    const current = await outputSnapshot(confined);
    if (current !== expected) throw new Error(`output_changed_during_generation: ${relative}; current content preserved`);
    if (current !== null) {
      const backup = path.join(root, '.wiki', 'output-backups', hashText(relative), hashText(current) + '.md');
      await safeWriteFile(backup, current);
      if (await readFile(backup, 'utf8') !== current) throw new Error('output_backup_verification_failed');
      await pruneBackups(path.dirname(backup), backup);
    }
    return publish();
  });
}

/** Backups kept per output; older ones are removed, never the one just written. */
export const OUTPUT_BACKUPS_KEPT = 5;
async function pruneBackups(dir: string, keep: string): Promise<void> {
  const entries = await Promise.all((await readdir(dir)).map(async (name) => {
    const file = path.join(dir, name);
    return { file, mtime: (await stat(file)).mtimeMs };
  }));
  const stale = entries.filter((e) => e.file !== keep).sort((a, b) => b.mtime - a.mtime).slice(OUTPUT_BACKUPS_KEPT - 1);
  for (const entry of stale) await rm(entry.file, { force: true });
}
