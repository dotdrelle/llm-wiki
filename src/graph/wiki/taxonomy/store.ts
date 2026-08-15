import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeWriteFile, withFileLock } from '../../../utils/fs.ts';
import { canonicalJson, contentHash } from './canonical.ts';

/*
 Registre de taxonomie : générations immuables, marqueur-pointeur.

 Un unique `communities.json` réécrit avant le marqueur ne tient pas la
 promesse « le registre précédent reste actif » : si le producteur meurt entre
 l'écriture et la publication, le contenu précédent est déjà perdu et rien ne
 le reconstruit au redémarrage. Chaque contenu validé est donc écrit dans une
 génération immuable adressée par son empreinte, et le `rename` du marqueur est
 le SEUL point de publication.

 C'est le motif objets/références : une génération que personne ne référence
 est inerte, deux producteurs concurrents écrivent deux fichiers qui ne se
 rencontrent jamais, et l'écriture peut donc se faire hors du verrou. Le verrou
 ne protège plus qu'un compare-and-swap sur le pointeur.
*/

/** Section critique réduite à un `rename` : dépasser cela, c'est être mort. */
export const REVISION_LOCK_TTL_MS = 45_000;
/** Palier plafonné : budget d'attente long ET régulier (~60 s au total). */
export const REVISION_LOCK_ATTEMPTS = 240;
export const REVISION_LOCK_MAX_BACKOFF_MS = 250;
/** La courante, plus trois publiées : fenêtre de grâce des lecteurs. */
export const GENERATION_RETENTION = 4;
/**
 * Une orpheline peut appartenir à un producteur qui attend encore le verrou.
 * Le seuil dépasse donc le budget d'acquisition, avec une marge.
 */
export const ORPHAN_MIN_AGE_MS = 120_000;

export type TaxonomyMarker = {
  /** Compteur monotone par workspace. Ne recule jamais. */
  revision: number;
  /** Empreinte du corpus sur laquelle la génération a été calculée. */
  corpus: string;
  /**
   * Algorithme ayant produit `corpus`.
   *
   * Absent sur les marqueurs historiques, qui portaient l'empreinte large du
   * graphe complet. Deux empreintes d'algorithmes différents ne se comparent
   * pas : `isComparableCorpus` répond « non » plutôt que de laisser une égalité
   * de chaînes trancher au hasard, et l'appelant traite cela comme une absence
   * d'information — jamais comme une péremption du corpus.
   */
  corpusAlgorithm?: string;
  /** Nom de fichier de la génération active, ou null pour une révision déterministe pure. */
  registryRef: string | null;
  /** Empreinte du contenu de cette génération. */
  registryHash: string | null;
  /** Générations publiées précédentes conservées pour les lecteurs en vol. */
  retainedRegistryRefs?: string[];
  /** Horodatage de publication, informatif. */
  publishedAt: number;
};

export type DirtyFlag = {
  /**
   * `deterministic` — Serve sait recalculer ce travail depuis les fichiers et
   * le reprend seul. `pendingSynthesis` — la proposition vivait en mémoire du
   * producteur et a disparu avec lui ; Serve ne rappelle jamais le modèle, il
   * signale et laisse la capacité orchestrée reprendre.
   */
  kind: 'deterministic' | 'pendingSynthesis';
  corpus: string;
  baseRevision: number;
  at: number;
};

export type TaxonomyPaths = {
  dir: string;
  marker: string;
  lock: string;
  dirty: string;
};

export function taxonomyPaths(rootDir: string): TaxonomyPaths {
  const dir = path.join(rootDir, '.wiki', 'graph');
  return {
    dir,
    marker: path.join(dir, 'revision.json'),
    lock: path.join(dir, 'revision.lock'),
    dirty: path.join(dir, 'dirty.json'),
  };
}

const GENERATION_PREFIX = 'communities.';
const GENERATION_SUFFIX = '.json';

export function generationName(hash: string): string {
  return `${GENERATION_PREFIX}${hash}${GENERATION_SUFFIX}`;
}

function generationHash(name: string): string | null {
  if (!name.startsWith(GENERATION_PREFIX) || !name.endsWith(GENERATION_SUFFIX)) return null;
  const hash = name.slice(GENERATION_PREFIX.length, -GENERATION_SUFFIX.length);
  return /^[0-9a-f]{32}$/.test(hash) ? hash : null;
}

/**
 * Écrit une génération — **hors verrou**.
 *
 * Sûr parce qu'immuable : le nom dérive du contenu, donc deux producteurs
 * distincts écrivent deux fichiers distincts, et réécrire la même génération
 * réécrit les mêmes octets. Tant qu'aucun marqueur ne la référence, elle
 * n'existe pour personne.
 */
export async function writeGeneration(
  rootDir: string,
  registry: unknown,
): Promise<{ ref: string; hash: string; canonical: string }> {
  const canonical = canonicalJson(registry);
  const hash = contentHash(canonical);
  const ref = generationName(hash);
  await safeWriteFile(path.join(taxonomyPaths(rootDir).dir, ref), canonical);
  return { ref, hash, canonical };
}

/**
 * Deux empreintes de corpus sont-elles comparables ?
 *
 * Un marqueur historique porte l'empreinte large du graphe complet, sans nom
 * d'algorithme. La comparer à l'empreinte de connaissance donnerait une
 * inégalité systématique — vraie par accident, et interprétée comme « le corpus
 * a changé » alors que personne n'a rien écrit. La bonne réponse est « je ne
 * sais pas », et c'est ce que ce prédicat permet de dire.
 */
export function isComparableCorpus(marker: TaxonomyMarker | null, algorithm: string): boolean {
  return Boolean(marker) && marker!.corpusAlgorithm === algorithm;
}

export async function readMarker(rootDir: string): Promise<TaxonomyMarker | null> {
  try {
    const raw = await readFile(taxonomyPaths(rootDir).marker, 'utf8');
    const marker = JSON.parse(raw) as TaxonomyMarker;
    return typeof marker?.revision === 'number' ? marker : null;
  } catch {
    // Absent au premier démarrage, tronqué si un disque a lâché : dans les deux
    // cas le lecteur retombe sur la projection déterministe, jamais sur une
    // erreur.
    return null;
  }
}

/**
 * Lecture cohérente : **registre d'abord, marqueur ensuite**.
 *
 * Une seule relecture suffit. Le registre est publié par `rename`, donc jamais
 * observable à moitié ; le risque n'est pas la déchirure mais la fraîcheur —
 * lire la génération de la révision N et découvrir que le monde est en N+1. La
 * révision étant monotone, il n'y a pas d'ABA, et comparer le marqueur APRÈS
 * coup détecte tous les cas.
 */
export async function readActiveRegistry(
  rootDir: string,
  attempts = 3,
): Promise<{ marker: TaxonomyMarker; registry: unknown } | null> {
  const paths = taxonomyPaths(rootDir);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const marker = await readMarker(rootDir);
    if (!marker) return null;
    if (!marker.registryRef || !marker.registryHash) return { marker, registry: null };

    let canonical: string;
    try {
      canonical = await readFile(path.join(paths.dir, marker.registryRef), 'utf8');
    } catch {
      continue;
    }
    if (contentHash(canonical) !== marker.registryHash) continue;

    const after = await readMarker(rootDir);
    if (after?.revision !== marker.revision) continue;
    return { marker, registry: JSON.parse(canonical) };
  }
  return null;
}

export type PublishOutcome =
  | { status: 'published'; marker: TaxonomyMarker }
  | { status: 'stale'; marker: TaxonomyMarker | null }
  | { status: 'unavailable'; error: unknown };

/**
 * Publie une génération déjà écrite : le compare-and-swap du pointeur.
 *
 * `expectedCorpus` est l'empreinte sur laquelle la proposition a été calculée.
 * Relue sous verrou, si elle a bougé, la proposition est abandonnée : elle
 * décrit un corpus qui n'existe plus, et l'écraser reviendrait à publier une
 * taxonomie par-dessus une ingestion plus récente.
 */
export async function publishGeneration(
  rootDir: string,
  input: {
    corpus: string;
    registryRef: string | null;
    registryHash: string | null;
    expectedCorpus?: string;
    /** Algorithme de `corpus`. Absent ⇒ marqueur historique, non comparable. */
    corpusAlgorithm?: string;
  },
  // Les défauts sont ceux du produit ; un appelant à contrainte différente — un
  // CLI ponctuel, un test — resserre le budget sans redéfinir la politique.
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<PublishOutcome> {
  const paths = taxonomyPaths(rootDir);
  try {
    const outcome = await withFileLock(
      paths.lock,
      async (): Promise<PublishOutcome> => {
        const current = await readMarker(rootDir);
        /*
         L'attente ne se vérifie qu'entre empreintes comparables.

         Un marqueur historique porte l'empreinte large du graphe complet. La
         confronter à une empreinte de connaissance donnerait une inégalité
         permanente : la toute première publication après migration serait
         rejetée comme « périmée », et la suivante aussi, indéfiniment. Le
         compare-and-swap n'a de sens qu'entre deux valeurs produites par le même
         algorithme ; sinon il n'y a rien à comparer, et la publication passe.
        */
        const comparable = !current
          || current.corpusAlgorithm === input.corpusAlgorithm;
        if (
          input.expectedCorpus !== undefined &&
          current &&
          comparable &&
          current.corpus !== input.expectedCorpus
        ) {
          return { status: 'stale', marker: current };
        }
        const marker: TaxonomyMarker = {
          revision: (current?.revision ?? 0) + 1,
          corpus: input.corpus,
          ...(input.corpusAlgorithm ? { corpusAlgorithm: input.corpusAlgorithm } : {}),
          registryRef: input.registryRef,
          registryHash: input.registryHash,
          retainedRegistryRefs: [
            ...(current?.registryRef && current.registryRef !== input.registryRef
              ? [current.registryRef]
              : []),
            ...(current?.retainedRegistryRefs ?? []),
          ]
            .filter((ref, index, refs) => ref !== input.registryRef && refs.indexOf(ref) === index)
            .slice(0, GENERATION_RETENTION - 1),
          publishedAt: Date.now(),
        };
        await safeWriteFile(paths.marker, canonicalJson(marker));
        return { status: 'published', marker };
      },
      {
        ttlMs: lock.ttlMs ?? REVISION_LOCK_TTL_MS,
        attempts: lock.attempts ?? REVISION_LOCK_ATTEMPTS,
        maxBackoffMs: lock.maxBackoffMs ?? REVISION_LOCK_MAX_BACKOFF_MS,
      },
    );
    if (outcome.status === 'published') {
      // Le ramassage est best-effort et hors verrou : une panne de nettoyage
      // ne doit jamais transformer un commit déjà publié en échec apparent.
      try {
        await collectGenerations(rootDir);
      } catch {
        // Le prochain commit ou démarrage de Serve retentera.
      }
    }
    return outcome;
  } catch (error) {
    /*
     Invariant : l'échec d'allocation d'une révision ne fait JAMAIS échouer
     l'ingestion. `withFileLock` propage son exception ; la laisser remonter
     tuerait un job de production pour un problème d'affichage. Le graphe a le
     droit d'être en retard, le corpus n'a pas le droit d'être perdu.
    */
    return { status: 'unavailable', error };
  }
}

export async function writeDirtyFlag(rootDir: string, flag: DirtyFlag): Promise<void> {
  await safeWriteFile(taxonomyPaths(rootDir).dirty, canonicalJson(flag));
}

export async function readDirtyFlag(rootDir: string): Promise<DirtyFlag | null> {
  try {
    const raw = await readFile(taxonomyPaths(rootDir).dirty, 'utf8');
    const flag = JSON.parse(raw) as DirtyFlag;
    return flag?.kind === 'deterministic' || flag?.kind === 'pendingSynthesis' ? flag : null;
  } catch {
    return null;
  }
}

export async function clearDirtyFlag(rootDir: string): Promise<void> {
  await rm(taxonomyPaths(rootDir).dirty, { force: true });
}

/**
 * Ramasse les générations devenues inutiles.
 *
 * Trois règles, et la troisième est le piège : une génération écrite il y a
 * 200 ms peut appartenir à un producteur qui attend encore le verrou. La
 * supprimer casserait sa publication, alors même qu'elle paraît orpheline.
 */
export async function collectGenerations(
  rootDir: string,
  options: { retention?: number; minAgeMs?: number; now?: number } = {},
): Promise<string[]> {
  const retention = options.retention ?? GENERATION_RETENTION;
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const now = options.now ?? Date.now();
  const paths = taxonomyPaths(rootDir);

  const marker = await readMarker(rootDir);
  let names: string[];
  try {
    names = await readdir(paths.dir);
  } catch {
    return [];
  }

  const generations: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!generationHash(name)) continue;
    try {
      const info = await stat(path.join(paths.dir, name));
      generations.push({ name, mtimeMs: info.mtimeMs });
    } catch {
      // Disparue entre readdir et stat : rien à ramasser.
    }
  }

  const retained = new Set([
    ...(marker?.registryRef ? [marker.registryRef] : []),
    ...(marker?.retainedRegistryRefs ?? []).slice(0, Math.max(0, retention - 1)),
  ]);
  const removed: string[] = [];
  for (const generation of generations) {
    // Seul l'historique du marqueur prouve qu'une génération a été publiée.
    // Le mtime ne distingue pas une ancienne publication d'une proposition
    // orpheline écrite par un producteur qui n'a jamais acquis le verrou.
    if (retained.has(generation.name)) continue;
    if (now - generation.mtimeMs < minAgeMs) continue;
    await rm(path.join(paths.dir, generation.name), { force: true });
    removed.push(generation.name);
  }
  return removed;
}
