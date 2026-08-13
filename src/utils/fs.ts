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
 * Verrou de fichier inter-processus.
 *
 * `maxBackoffMs` existe parce que le backoff `50 × (n+1)` n'est pas plafonné :
 * il croît linéairement, donc le budget d'attente croît en n². Vingt tentatives
 * ne font que 10,5 s, et allonger la liste fait exploser la durée des dernières
 * attentes (2,4 s à la 48ᵉ). Un appelant qui a besoin d'un budget long ET
 * régulier — le verrou de révision du graphe, dont la section critique n'est
 * qu'un `rename` — plafonne le palier et augmente le nombre de tentatives.
 * Les défauts ne changent pas : les autres appelants gardent leur comportement.
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
   Récupérer un verrou périmé ne doit pas coûter une tentative.

   Sinon `attempts: 1` échoue toujours : la seule tentative est dépensée à
   effacer le verrou mort, et la boucle sort sans jamais avoir réessayé
   d'ouvrir. Le budget est donc rendu — mais un nombre borné de fois, pour
   qu'un verrou sans cesse recréé ne fasse pas tourner la boucle indéfiniment.
  */
  let reclaimBudget = 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      /*
       Le TTL est examiné à CHAQUE tentative, y compris la dernière.

       La condition testait `attempt === attempts - 1` avant de regarder le
       verrou : un propriétaire mort dont le verrou venait d'expirer faisait
       échouer l'appel au lieu d'être récupéré, précisément au moment où la
       récupération était la seule issue restante.
      */
      let reclaimed = false;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > ttlMs) {
          await rm(lockPath, { force: true });
          reclaimed = true;
        }
      } catch (statError) {
        // Le propriétaire a pu relâcher le verrou entre EEXIST et stat : il n'y
        // a alors plus rien à attendre. Toute autre erreur (droits, E/S) ne dit
        // rien sur la disponibilité du verrou et ne doit pas déclencher une
        // boucle serrée : on retombe sur l'attente normale.
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
