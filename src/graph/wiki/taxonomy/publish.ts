import { KNOWLEDGE_ETAG_ALGORITHM, knowledgeEtag } from './knowledge.ts';
import { publishGeneration, readMarker, writeDirtyFlag } from './store.ts';

export type CorpusPublishOutcome =
  | { status: 'published'; revision: number; corpus: string }
  | { status: 'deferred'; corpus: string | null };

/**
 * Publie une révision déterministe après une écriture cohérente du wiki.
 *
 * L'empreinte est celle du **corpus de connaissance** (`knowledgeEtag`), la
 * même que celle sur laquelle la synthèse calcule et publie : deux empreintes
 * calculées autrement rendraient la comparaison de péremption sous verrou sans
 * valeur. Elle ignore délibérément templates, contextes et deliverables — un
 * build ne périme pas un classement.
 *
 * La génération de registre active, s'il y en a une, est reconduite telle
 * quelle : une ingestion ne connaît rien à la taxonomie synthétisée et n'a
 * aucune raison de la retirer. Elle fait avancer la révision, c'est tout.
 *
 * **Ne lève jamais.** Une révision non allouée est un problème d'affichage ; la
 * faire remonter tuerait un job de production qui a, lui, réussi. En cas
 * d'échec, le drapeau `dirty.json` prend le relais et Serve reprendra — ce
 * travail-là, il sait le refaire, puisqu'il se recalcule depuis les fichiers.
 */
export async function publishCorpusRevision(
  rootDir: string,
  lock: { ttlMs?: number; attempts?: number; maxBackoffMs?: number } = {},
): Promise<CorpusPublishOutcome> {
  let corpus: string | null = null;
  try {
    corpus = await knowledgeEtag(rootDir);
    const current = await readMarker(rootDir);

    // Une révision décrit un changement observable. Republier le même corpus
    // ferait clignoter tous les clients et gonflerait le compteur sans état
    // nouveau, notamment lorsqu'une source inchangée traverse le pipeline.
    //
    // L'égalité n'a de sens qu'entre empreintes du même algorithme : un
    // marqueur historique doit être republié pour migrer, même si sa chaîne
    // ressemble à la nôtre.
    if (current?.corpus === corpus && current.corpusAlgorithm === KNOWLEDGE_ETAG_ALGORITHM) {
      return { status: 'published', revision: current.revision, corpus };
    }

    const outcome = await publishGeneration(
      rootDir,
      {
        corpus,
        corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
        registryRef: current?.registryRef ?? null,
        registryHash: current?.registryHash ?? null,
      },
      lock,
    );

    if (outcome.status === 'published') {
      return { status: 'published', revision: outcome.marker.revision, corpus };
    }

    await writeDirtyFlag(rootDir, {
      kind: 'deterministic',
      corpus,
      baseRevision: current?.revision ?? 0,
      at: Date.now(),
    });
    return { status: 'deferred', corpus };
  } catch {
    // Y compris l'écriture du drapeau : si même elle échoue, la prochaine
    // ingestion republiera. Rien de tout cela ne remonte à l'appelant.
    return { status: 'deferred', corpus };
  }
}
