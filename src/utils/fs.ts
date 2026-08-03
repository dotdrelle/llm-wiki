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

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: { ttlMs?: number; attempts?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const attempts = options.attempts ?? 20;
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle: FileHandle | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === attempts - 1) {
        throw error;
      }
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > ttlMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // The owner may have released the lock between EEXIST and stat.
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
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
