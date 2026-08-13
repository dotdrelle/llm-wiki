import { watch, type FSWatcher } from 'node:fs';
import { collectGenerations, readMarker, taxonomyPaths, type TaxonomyMarker } from './store.ts';
import { recoverPendingWork } from './recovery.ts';

/** Repli quand les notifications ne traversent pas le mount. */
export const TAXONOMY_POLL_INTERVAL_MS = 1_500;
/** Regroupe les notifications rapprochées d'une même publication. */
export const TAXONOMY_DEBOUNCE_MS = 150;

export type TaxonomyWatcher = {
  /** Vérifie l'état maintenant, sans attendre le prochain réveil. */
  check: () => Promise<void>;
  stop: () => void;
};

/**
 * Surveille le marqueur de révision d'un workspace.
 *
 * Un seul watcher et un seul timer **par workspace Serve**, jamais un par
 * client SSE : les clients s'abonnent à ce que celui-ci publie.
 *
 * `fs.watch`/inotify n'est pas fiable à travers un bind mount Docker, ce qui
 * est précisément le déploiement visé. On tente donc le watcher natif et on
 * dégrade sur un `stat` périodique. Ce sondage n'est pas le polling retiré du
 * client : c'est une lecture d'inode côté serveur, sans transfert et sans effet
 * sur le rendu — à ne pas confondre avec un rapatriement de scène.
 *
 * On surveille le RÉPERTOIRE, pas le fichier : le marqueur est publié par
 * `rename`, donc son inode est remplacé à chaque révision et un watcher posé
 * sur le fichier suivrait l'ancien inode jusqu'à ne plus rien voir.
 */
export function createTaxonomyWatcher(options: {
  rootDir: string;
  /** Appelé une seule fois par révision réellement nouvelle. */
  onRevision: (marker: TaxonomyMarker) => void;
  pollIntervalMs?: number;
  debounceMs?: number;
  /** Reprise du travail en attente ; désactivable pour un lecteur passif. */
  recover?: boolean;
}): TaxonomyWatcher {
  const paths = taxonomyPaths(options.rootDir);
  const pollIntervalMs = options.pollIntervalMs ?? TAXONOMY_POLL_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? TAXONOMY_DEBOUNCE_MS;
  const recover = options.recover ?? true;

  let lastRevision = -1;
  let initialCollectionPending = true;
  let stopped = false;
  /*
   Les vérifications sont sérialisées par une file, pas par un drapeau.

   Un drapeau « une à la fois » qui fait sortir l'appelant sans rien vérifier
   rend `check()` menteur : la promesse se résout alors qu'aucune lecture n'a eu
   lieu, et un appelant qui vient d'écrire — ou un test — observe l'état
   d'avant. La file garantit qu'attendre `check()`, c'est attendre une
   vérification commencée APRÈS l'appel.
  */
  let queue: Promise<void> = Promise.resolve();
  let watcher: FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  const interval = setInterval(() => void check(), pollIntervalMs);
  // Un timer de sondage ne doit pas maintenir le processus en vie à lui seul.
  interval.unref?.();

  function check(): Promise<void> {
    queue = queue.then(runCheck, runCheck);
    return queue;
  }

  async function runCheck(): Promise<void> {
    if (stopped) return;
    try {
      if (initialCollectionPending) {
        initialCollectionPending = false;
        await collectGenerations(options.rootDir);
      }
      if (recover) await recoverPendingWork(options.rootDir);
      const marker = await readMarker(options.rootDir);
      if (!marker) return;
      /*
       La comparaison porte sur le NUMÉRO de révision, pas sur le `mtime`.

       Un mtime bouge à chaque réécriture, y compris identique, et sa
       granularité varie selon le système de fichiers — deux publications dans
       la même seconde peuvent partager le sien. Le compteur monotone, lui, dit
       exactement ce qu'on veut savoir : y a-t-il du neuf.
      */
      if (marker.revision <= lastRevision) return;
      lastRevision = marker.revision;
      options.onRevision(marker);
    } catch {
      // Une lecture ratée n'arrête pas la surveillance : le prochain réveil
      // retentera. Un watcher qui meurt sur une erreur transitoire laisserait
      // l'écran muet jusqu'au redémarrage de Serve.
    }
  }

  function schedule(): void {
    if (stopped || debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void check();
    }, debounceMs);
    debounce.unref?.();
  }

  function attach(): void {
    if (stopped) return;
    try {
      watcher = watch(paths.dir, (_event, name) => {
        // Le répertoire porte aussi les générations, bien plus nombreuses que
        // les publications. Les ignorer évite de relire le marqueur à chaque
        // proposition écrite, publiée ou non.
        if (name && name !== 'revision.json' && name !== 'dirty.json') return;
        schedule();
      });
      watcher.on('error', () => {
        // Le mount ne propage pas les notifications : le sondage prend le
        // relais, seul. C'est la dégradation prévue, pas une panne.
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  attach();
  void check();

  return {
    check,
    stop() {
      stopped = true;
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      debounce = null;
      watcher?.close();
      watcher = null;
    },
  };
}
