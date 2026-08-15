import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeWriteFile } from '../utils/fs.ts';

/*
 Cache of extraction and consolidation calls.

 A session interruption, a quota overflow or a simple `Ctrl-C` must not force
 repaying calls whose answer was valid. The cache is therefore addressed by what
 DETERMINES the answer: the text sent, the model that answered, and the prompt
 and schema versions. Changing any of the four changes the key — which is what
 avoids re-serving an answer produced by a contract that no longer exists.

 This cache is a DIAGNOSTIC and resume artifact. It is never presented as an
 approvable plan: the only object submitted to review remains the final
 consolidated plan.
*/

const CACHE_DIR = ['.wiki', 'ingest-cache'];
/** Beyond this, an entry describes a corpus state that nobody will replay again. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ExtractionCacheKey = {
  sourceHash: string;
  packIndex: number;
  packHash: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
};

export type ConsolidationCacheKey = {
  sourceHash: string;
  /** Fingerprint of the ORDERED extractions: their order changes the prompt. */
  extractionsHash: string;
  /** Fingerprint of the relevant inventory presented to the model. */
  inventoryHash: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
};

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

function keyToName(prefix: string, parts: Array<string | number>): string {
  return `${prefix}-${hashText(parts.join(''))}.json`;
}

export function extractionCacheName(key: ExtractionCacheKey): string {
  return keyToName('extract', [
    key.sourceHash,
    key.packIndex,
    key.packHash,
    key.model,
    key.promptVersion,
    key.schemaVersion,
  ]);
}

export function consolidationCacheName(key: ConsolidationCacheKey): string {
  return keyToName('consolidate', [
    key.sourceHash,
    key.extractionsHash,
    key.inventoryHash,
    key.model,
    key.promptVersion,
    key.schemaVersion,
  ]);
}

export class IngestCache {
  private readonly rootDir: string;
  private readonly enabled: boolean;

  constructor(rootDir: string, enabled = true) {
    this.rootDir = rootDir;
    this.enabled = enabled;
  }

  private file(name: string): string {
    return path.join(this.rootDir, ...CACHE_DIR, name);
  }

  async read<T>(name: string): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      return JSON.parse(await readFile(this.file(name), 'utf8')) as T;
    } catch {
      // Absent, unreadable or truncated: in all three cases, the call is redone.
      // A cache must never be a reason to fail.
      return null;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    if (!this.enabled) return;
    try {
      await mkdir(path.join(this.rootDir, ...CACHE_DIR), { recursive: true });
      await safeWriteFile(this.file(name), `${JSON.stringify(value, null, 2)}\n`);
    } catch {
      // A full disk must not make a successful ingestion fail.
    }
  }

  /** Best-effort collection of entries too old to serve a resume. */
  async collect(now = Date.now()): Promise<number> {
    const dir = path.join(this.rootDir, ...CACHE_DIR);
    let removed = 0;
    try {
      for (const name of await readdir(dir)) {
        const file = path.join(dir, name);
        const info = await stat(file).catch(() => null);
        if (!info || now - info.mtimeMs < CACHE_MAX_AGE_MS) continue;
        await rm(file, { force: true });
        removed += 1;
      }
    } catch {
      // Directory absent: nothing to collect.
    }
    return removed;
  }
}
