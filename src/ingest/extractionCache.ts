import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeWriteFile } from '../utils/fs.ts';

/*
 Cache des appels d'extraction et de consolidation.

 Une coupure de session, un dépassement de quota ou un simple `Ctrl-C` ne doit
 pas obliger à repayer des appels dont la réponse était valide. Le cache est
 donc adressé par ce qui DÉTERMINE la réponse : le texte envoyé, le modèle qui a
 répondu, et les versions du prompt et du schéma. Changer l'un des quatre change
 la clé — c'est ce qui évite de resservir une réponse produite par un contrat
 qui n'existe plus.

 Ce cache est un artefact de DIAGNOSTIC et de reprise. Il n'est jamais présenté
 comme un plan approuvable : le seul objet soumis à revue reste le plan consolidé
 final.
*/

const CACHE_DIR = ['.wiki', 'ingest-cache'];
/** Au-delà, une entrée décrit un état du corpus que plus personne ne rejouera. */
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
  /** Empreinte des extractions ORDONNÉES : leur ordre change le prompt. */
  extractionsHash: string;
  /** Empreinte de l'inventaire pertinent présenté au modèle. */
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
      // Absente, illisible ou tronquée : dans les trois cas, l'appel est refait.
      // Un cache ne doit jamais être une raison d'échouer.
      return null;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    if (!this.enabled) return;
    try {
      await mkdir(path.join(this.rootDir, ...CACHE_DIR), { recursive: true });
      await safeWriteFile(this.file(name), `${JSON.stringify(value, null, 2)}\n`);
    } catch {
      // Un disque plein ne doit pas faire échouer une ingestion qui a réussi.
    }
  }

  /** Ramassage best-effort des entrées trop anciennes pour servir une reprise. */
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
      // Répertoire absent : rien à ramasser.
    }
    return removed;
  }
}
