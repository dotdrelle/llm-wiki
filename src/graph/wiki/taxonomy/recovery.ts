import {
  clearDirtyFlag,
  publishGeneration,
  readDirtyFlag,
  readMarker,
  type PublishOutcome,
} from './store.ts';

export type RecoveryOutcome =
  | { status: 'idle' }
  | { status: 'recovered'; revision: number }
  | { status: 'signalled'; revision: number | null }
  /** Le corpus a changé depuis l'échec : le travail en attente ne vaut plus. */
  | { status: 'superseded'; revision: number | null }
  | { status: 'deferred' };

/**
 * Reprend le travail laissé en attente par un producteur qui n'a pas pu publier.
 *
 * Le drapeau n'a pas le même pouvoir selon son origine, et les confondre
 * promettrait une reprise impossible :
 *
 * - `deterministic` — la projection se recalcule intégralement depuis les
 *   fichiers du corpus. Serve sait donc réellement reprendre : il publie et
 *   efface le drapeau.
 * - `pendingSynthesis` — la proposition validée vivait en mémoire du producteur
 *   et a disparu avec lui. Serve **n'appelle jamais le modèle** (D2) : il ne
 *   peut pas la reconstituer. Il publie l'état déterministe en conservant la
 *   génération de registre du commit précédent, garde le drapeau, et laisse la
 *   reprise à la prochaine exécution de la capacité orchestrée.
 *
 * Dans les deux cas le registre précédent reste actif : jamais une génération
 * orpheline, jamais un état partiel.
 */
export async function recoverPendingWork(
  rootDir: string,
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<RecoveryOutcome> {
  const flag = await readDirtyFlag(rootDir);
  if (!flag) return { status: 'idle' };

  const current = await readMarker(rootDir);
  if (flag.kind === 'pendingSynthesis' && current?.corpus === flag.corpus) {
    // Le signal doit survivre pour l'orchestrateur, pas créer une nouvelle
    // révision à chaque poll du watcher. L'état déterministe visé est déjà
    // publié ; il ne reste précisément que la synthèse que Serve ne sait pas
    // refaire.
    return { status: 'signalled', revision: current.revision };
  }

  /*
   Une empreinte de corpus ne recule jamais.

   Le drapeau porte l'empreinte figée à l'instant de l'échec. Rien n'empêche une
   ingestion d'aboutir ENTRE cet échec et cette reprise : le marqueur décrit
   alors un corpus plus récent, et republier `flag.corpus` le ferait repartir en
   arrière. Le registre actif resterait pourtant celui d'aujourd'hui — le
   marqueur mentirait donc sur ce à quoi il correspond, et tout consommateur qui
   compare les empreintes verrait le corpus « changer » à l'envers.

   La révision est le seul ordre total dont on dispose : elle est monotone par
   construction. Si elle a dépassé la base du drapeau ET que l'empreinte diffère,
   quelqu'un a publié depuis, et ce drapeau parle d'un état révolu.
  */
  const movedOn = Boolean(
    current && current.revision > flag.baseRevision && current.corpus !== flag.corpus,
  );
  if (movedOn) {
    if (flag.kind === 'deterministic') {
      // La projection réclamée a été supplantée par une plus récente : il n'y a
      // plus rien à reprendre, et garder le drapeau ferait boucler le watcher.
      await clearDirtyFlag(rootDir);
      return { status: 'superseded', revision: current?.revision ?? null };
    }
    /*
     La synthèse, elle, reste due : personne ne l'a refaite pour le nouveau
     corpus non plus. Le drapeau survit pour que la capacité orchestrée la
     reprenne — mais sans toucher au marqueur, qui est déjà à jour.
    */
    return { status: 'signalled', revision: current?.revision ?? null };
  }

  const outcome: PublishOutcome = await publishGeneration(
    rootDir,
    {
      corpus: flag.corpus,
      // La synthèse perdue ne doit pas emporter la taxonomie active : on
      // republie le pointeur courant, pas un pointeur vide.
      registryRef: current?.registryRef ?? null,
      registryHash: current?.registryHash ?? null,
    },
    lock,
  );

  if (outcome.status !== 'published') {
    // Verrou indisponible ou base périmée : on retentera. Le drapeau reste,
    // c'est précisément son rôle.
    return { status: 'deferred' };
  }

  if (flag.kind === 'deterministic') {
    await clearDirtyFlag(rootDir);
    return { status: 'recovered', revision: outcome.marker.revision };
  }

  /*
   `pendingSynthesis` : la révision avance — l'écran voit l'état déterministe
   le plus récent — mais le drapeau SURVIT. L'effacer reviendrait à prétendre
   que la synthèse a été reprise, et plus personne ne saurait qu'elle manque.
  */
  return { status: 'signalled', revision: outcome.marker.revision };
}
