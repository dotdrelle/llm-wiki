import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { safeWriteFile } from '../../../utils/fs.ts';
import { toPosix } from '../../../utils/path.ts';
import { canonicalJson } from './canonical.ts';

/*
 Empreinte de connaissance — ce sur quoi la taxonomie a le droit de se périmer.

 `wikiGraphEtagForFiles` décrit le RENDU du graphe : elle couvre templates,
 contextes de build, deliverables et `build-state.json`, et elle hache `mtime` +
 taille. C'est correct pour invalider un cache d'affichage, et faux pour décider
 qu'un classement est périmé — un `build` qui ne touche aucune page de
 connaissance, une copie du workspace ou un `git clone` suffisaient à déclarer
 la carte obsolète. Un avertissement qui s'allume sans raison est un
 avertissement qu'on apprend à ignorer, et le corpus réellement périmé passe
 alors inaperçu.

 Cette empreinte-ci ne voit donc que les pages de connaissance, et seulement par
 leur contenu.
*/

/**
 * Types de nœuds qui constituent le corpus de connaissance.
 *
 * Source de vérité unique : l'inventaire, la projection et l'empreinte doivent
 * s'accorder sur ce qu'est une page de connaissance. Deux listes divergentes
 * autoriseraient un fichier à être classé sans participer à l'empreinte — donc
 * un classement qui ne se périme jamais — ou l'inverse.
 */
export const KNOWLEDGE_NODE_TYPES = new Set(['wiki', 'wiki-source', 'raw-source']);

/**
 * Fichiers correspondants, exprimés une seule fois.
 *
 * Le miroir des types ci-dessus : `wiki/**` donne `wiki` et `wiki-source`,
 * `raw/ingested/**` donne `raw-source`. `wiki/log.md` est le journal technique —
 * il est réécrit à chaque job et ne porte aucune connaissance classable.
 */
export const KNOWLEDGE_FILE_PATTERNS = [
  'wiki/**/*.md',
  '!wiki/log.md',
  'raw/ingested/**/*.md',
];

/**
 * Version de l'algorithme d'empreinte, transportée par le marqueur.
 *
 * Deux empreintes calculées par deux algorithmes différents ne sont pas
 * comparables : les déclarer différentes serait vrai mais inutile, les déclarer
 * égales serait faux. On compare donc d'abord l'algorithme, et une divergence
 * se traite comme une absence d'information — pas comme une péremption.
 */
export const KNOWLEDGE_ETAG_ALGORITHM = 'knowledge-content-sha256-v1';

export async function listKnowledgeFiles(rootDir: string): Promise<string[]> {
  return (await fg(KNOWLEDGE_FILE_PATTERNS, { cwd: rootDir, dot: false }))
    .map(toPosix)
    .sort();
}

/**
 * Contenu logique d'une page : ce qui change son sens, rien d'autre.
 *
 * Les fins de ligne dépendent du système qui a écrit le fichier et les
 * blancs de fin dépendent de l'éditeur. Les intégrer ferait dépendre la
 * fraîcheur d'une taxonomie du poste de travail qui a fait le dernier `git
 * checkout`, ce qui est exactement le défaut qu'on corrige.
 */
export function knowledgeContentHash(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

type CacheEntry = { mtimeMs: number; size: number; hash: string };
type CacheFile = { algorithm: string; entries: Record<string, CacheEntry> };

function cachePath(rootDir: string): string {
  return path.join(rootDir, '.wiki', 'graph', 'knowledge-hash-cache.json');
}

/**
 * Cache de hachage — une optimisation, jamais une source de vérité.
 *
 * Hacher le contenu de ~230 pages à chaque publication, multiplié par le nombre
 * de sources d'un lot, est un coût réel. `mtime` et taille servent ici, et
 * seulement ici, à décider si le hash mémorisé est encore valable : ils
 * n'entrent jamais dans l'empreinte publiée. C'est la nuance qui fait tenir les
 * deux propriétés à la fois — une copie fidèle garde la même empreinte, et une
 * publication répétée ne relit pas tout le corpus.
 *
 * Supprimer ce fichier ne change donc aucun résultat, seulement une latence.
 */
async function readCache(rootDir: string): Promise<Map<string, CacheEntry>> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(rootDir), 'utf8')) as CacheFile;
    if (!parsed || parsed.algorithm !== KNOWLEDGE_ETAG_ALGORITHM) return new Map();
    return new Map(Object.entries(parsed.entries ?? {}));
  } catch {
    return new Map();
  }
}

async function writeCache(rootDir: string, entries: Map<string, CacheEntry>): Promise<void> {
  const payload: CacheFile = {
    algorithm: KNOWLEDGE_ETAG_ALGORITHM,
    entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  await safeWriteFile(cachePath(rootDir), canonicalJson(payload));
}

/**
 * Empreinte du corpus de connaissance : chemins canoniques + hash de contenu.
 *
 * Ne contient ni `mtime`, ni taille, ni horodatage. Deux workspaces dont les
 * pages ont le même contenu ont la même empreinte, quel que soit leur historique
 * de copie, de build ou d'export.
 */
export async function knowledgeEtagForFiles(
  rootDir: string,
  files: string[],
  options: { cache?: boolean } = {},
): Promise<string> {
  const useCache = options.cache ?? true;
  const previous = useCache ? await readCache(rootDir) : new Map<string, CacheEntry>();
  const next = new Map<string, CacheEntry>();
  const hash = createHash('sha256');
  hash.update(KNOWLEDGE_ETAG_ALGORITHM);
  hash.update('\0');

  for (const file of files) {
    const absolute = path.join(rootDir, file);
    let entry: CacheEntry | undefined;
    try {
      const fileStat = await stat(absolute);
      const cached = previous.get(file);
      if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
        entry = cached;
      } else {
        entry = {
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
          hash: knowledgeContentHash(await readFile(absolute, 'utf8')),
        };
      }
    } catch {
      // Un fichier disparu entre le listage et la lecture n'est pas une erreur
      // de publication : il n'appartient simplement pas à ce corpus.
      continue;
    }
    next.set(file, entry);
    hash.update(file);
    hash.update('\0');
    hash.update(entry.hash);
    hash.update('\0');
  }

  if (useCache) await writeCache(rootDir, next).catch(() => {});
  return hash.digest('hex');
}

/** Raccourci : liste puis empreinte, l'appel courant. */
export async function knowledgeEtag(
  rootDir: string,
  options: { cache?: boolean } = {},
): Promise<string> {
  return knowledgeEtagForFiles(rootDir, await listKnowledgeFiles(rootDir), options);
}
