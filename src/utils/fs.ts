import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}

export async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === content) {
      return false;
    }
  } catch {
    // Fall through to write the file.
  }

  await safeWriteFile(filePath, content);
  return true;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removeIfExists(filePath: string): Promise<void> {
  if (await pathExists(filePath)) {
    await rm(filePath, { recursive: true, force: true });
  }
}

/**
 * Cross-process file lock.
 *
 * `maxBackoffMs` exists because the `50 × (n+1)` backoff is not capped: it
 * grows linearly, so the wait budget grows as n². Twenty attempts only take
 * 10.5 s, and lengthening the list makes the final waits explode (2.4 s at the
 * 48th). A caller that needs a long AND regular budget — the graph revision
 * lock, whose critical section is only a `rename` — caps the step and increases
 * the number of attempts. The defaults do not change: other callers keep their
 * behavior.
 */
export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const attempts = options.attempts ?? 20;
  const maxBackoffMs = options.maxBackoffMs ?? Number.POSITIVE_INFINITY;
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle: FileHandle | undefined;
  /*
   Reclaiming an expired lock must not cost an attempt.

   Otherwise `attempts: 1` always fails: the only attempt is spent erasing the
   dead lock, and the loop exits without ever retrying the open. The budget is
   therefore refunded — but a bounded number of times, so that a lock endlessly
   recreated does not spin the loop forever.
  */
  let reclaimBudget = 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      /*
       The TTL is examined on EVERY attempt, including the last.

       The condition used to test `attempt === attempts - 1` before looking at
       the lock: a dead owner whose lock had just expired made the call fail
       instead of being reclaimed, precisely when reclaiming was the only way
       out left.
      */
      let reclaimed = false;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > ttlMs) {
          await rm(lockPath, { force: true });
          reclaimed = true;
        }
      } catch (statError) {
        // The owner may have released the lock between EEXIST and stat: there
        // is then nothing left to wait for. Any other error (permissions, I/O)
        // says nothing about the lock's availability and must not trigger a
        // tight loop: we fall back to the normal wait.
        reclaimed = (statError as NodeJS.ErrnoException).code === 'ENOENT';
      }
      if (reclaimed) {
        if (reclaimBudget > 0) {
          reclaimBudget -= 1;
          attempt -= 1;
        }
        continue;
      }
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (attempt + 1), maxBackoffMs)));
    }
  }
  if (!handle) throw new Error(`Could not acquire file lock: ${lockPath}`);
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
