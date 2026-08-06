import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Registre de provenance des sources.
 *
 * **Écriture seule à ce stade.** Rien ne le lit, rien ne s'appuie dessus, et
 * son absence ou sa corruption ne peut pas faire échouer une ingestion. C'est
 * délibéré : c'est l'étape T32.2 du cycle de vie
 * (`docs/content-lifecycle.md`), qui rend le problème observable avant de
 * chercher à le résoudre. Une passe de réconciliation ne peut pas être écrite
 * sans données à réconcilier, et fabriquer les données et la décision dans le
 * même lot rendrait chacune non vérifiable.
 *
 * Ce qu'il répond, une fois alimenté : quelles sources existent, quand chacune
 * a été vue pour la dernière fois, et **quelles pages elle a réellement
 * produites** — non ce que le modèle a proposé, mais ce qui a été appliqué.
 */

export const SOURCE_REGISTRY_VERSION = 1;

export type SourceStatus = 'active' | 'missing' | 'retracted';

export type SourceRecord = {
  /**
   * Identité stable de la source. Voir `docs/content-lifecycle.md` § 4.1 :
   * à terme fournie par le producteur (`confluence:page:123`). Tant qu'aucun
   * producteur ne la fournit, elle dérive du chemin d'archive — auquel cas un
   * renommage amont crée bien une source nouvelle, ce que le registre a
   * précisément vocation à rendre visible.
   */
  sourceId: string;
  archivePath: string;
  contentHash: string;
  status: SourceStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIngestedAt: string | null;
  /** Pages effectivement créées ou mises à jour par cette source. */
  producedPages: string[];
};

export type SourceRegistryFile = {
  version: number;
  sources: SourceRecord[];
};

export function sourceIdFromArchivePath(archivePath: string): string {
  return `path:${archivePath}`;
}

export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function emptyRegistry(): SourceRegistryFile {
  return { version: SOURCE_REGISTRY_VERSION, sources: [] };
}

/**
 * Lit le registre. Un fichier absent, illisible ou d'une version inconnue rend
 * un registre vide plutôt qu'une erreur : ce fichier est une observation, et
 * une observation ratée ne doit jamais interrompre le travail qu'elle observe.
 */
export async function readSourceRegistry(registryPath: string): Promise<SourceRegistryFile> {
  let raw: string;
  try {
    raw = await readFile(registryPath, 'utf8');
  } catch {
    return emptyRegistry();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SourceRegistryFile>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SOURCE_REGISTRY_VERSION) {
      return emptyRegistry();
    }
    return {
      version: SOURCE_REGISTRY_VERSION,
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter(isSourceRecord) : [],
    };
  } catch {
    return emptyRegistry();
  }
}

function isSourceRecord(value: unknown): value is SourceRecord {
  const record = value as Partial<SourceRecord> | null;
  return Boolean(
    record
      && typeof record.sourceId === 'string'
      && typeof record.archivePath === 'string'
      && Array.isArray(record.producedPages),
  );
}

/** Écriture atomique : un fichier tronqué serait pire qu'un fichier absent. */
export async function writeSourceRegistry(
  registryPath: string,
  registry: SourceRegistryFile,
): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true });
  const temporary = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(temporary, registryPath);
}

export type SourceObservation = {
  sourceId: string;
  archivePath: string;
  contentHash: string;
  /** Pages appliquées lors de cette ingestion. Vide pour une source inchangée. */
  producedPages?: string[];
  /** Faux pour une source vue mais non réingérée (`unchanged since last ingest`). */
  ingested: boolean;
  observedAt: string;
};

/**
 * Enregistre une source telle qu'elle vient d'être vue.
 *
 * Fonction pure : elle rend un nouveau registre, elle n'écrit rien. C'est ce
 * qui permet de la tester sans système de fichiers, et de la relire sans se
 * demander ce qu'elle touche par ailleurs.
 */
export function recordSourceObservation(
  registry: SourceRegistryFile,
  observation: SourceObservation,
): SourceRegistryFile {
  const existing = registry.sources.find((source) => source.sourceId === observation.sourceId);
  if (!existing) {
    return {
      ...registry,
      sources: [
        ...registry.sources,
        {
          sourceId: observation.sourceId,
          archivePath: observation.archivePath,
          contentHash: observation.contentHash,
          status: 'active',
          firstSeenAt: observation.observedAt,
          lastSeenAt: observation.observedAt,
          lastIngestedAt: observation.ingested ? observation.observedAt : null,
          producedPages: [...(observation.producedPages ?? [])].sort(),
        },
      ],
    };
  }

  return {
    ...registry,
    sources: registry.sources.map((source) => {
      if (source.sourceId !== observation.sourceId) return source;
      return {
        ...source,
        archivePath: observation.archivePath,
        contentHash: observation.contentHash,
        // Revoir une source la ramène à `active` : c'est la transition
        // `missing → active` de la spécification, et elle est gratuite ici.
        status: 'active',
        lastSeenAt: observation.observedAt,
        lastIngestedAt: observation.ingested ? observation.observedAt : source.lastIngestedAt,
        // Une source inchangée ne produit rien : garder l'ancienne liste plutôt
        // que de l'écraser par un tableau vide, sinon un simple ré-archivage
        // effacerait la trace de tout ce que la source avait produit.
        producedPages: observation.ingested
          ? [...new Set(observation.producedPages ?? [])].sort()
          : source.producedPages,
      };
    }),
  };
}

/**
 * Pages du wiki qu'aucune source vivante ne soutient.
 *
 * Une page orpheline n'est pas nécessairement fautive : elle peut avoir été
 * écrite à la main, ou produite avant l'existence du registre. C'est une
 * question posée à l'opérateur, jamais une suppression.
 */
export function orphanPages(registry: SourceRegistryFile, wikiPages: string[]): string[] {
  const supported = new Set(
    registry.sources
      .filter((source) => source.status === 'active')
      .flatMap((source) => source.producedPages),
  );
  return wikiPages.filter((page) => !supported.has(page)).sort();
}

export type ReconciliationReport = {
  /** Archives disparues du disque alors que le registre les connaît. */
  vanishedArchives: string[];
  /** Pages qu'une source a produites et qui n'existent plus. */
  vanishedPages: Array<{ sourceId: string; pages: string[] }>;
  /** Archives présentes sur le disque qu'aucune entrée du registre ne couvre. */
  unregisteredArchives: string[];
  /** Pages du wiki qu'aucune source vivante ne soutient. */
  orphans: string[];
};

export function isReportClean(report: ReconciliationReport): boolean {
  return report.vanishedArchives.length === 0
    && report.vanishedPages.length === 0
    && report.unregisteredArchives.length === 0
    && report.orphans.length === 0;
}

/**
 * Compare le registre à ce qui existe réellement sur le disque.
 *
 * **Rapporte, n'écrit rien, ne recrée rien.** Une page supprimée à la main est
 * une décision : la faire réapparaître serait la contredire, et la supprimer
 * ailleurs sans le dire serait pire. Le seul comportement défendable tant que
 * le retrait n'est pas spécifié bout en bout (T32.4) est de nommer l'écart.
 *
 * Fonction pure : l'appelant fournit les inventaires. C'est ce qui la rend
 * testable sur des cas que le système de fichiers rendrait pénibles à monter.
 */
export function reconcileRegistry(
  registry: SourceRegistryFile,
  present: { archives: string[]; wikiPages: string[] },
): ReconciliationReport {
  const archives = new Set(present.archives);
  const wikiPages = new Set(present.wikiPages);
  const active = registry.sources.filter((source) => source.status === 'active');

  const vanishedPages = active
    .map((source) => ({
      sourceId: source.sourceId,
      pages: source.producedPages.filter((page) => !wikiPages.has(page)).sort(),
    }))
    .filter((entry) => entry.pages.length > 0)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const registered = new Set(registry.sources.map((source) => source.archivePath));

  return {
    vanishedArchives: active
      .map((source) => source.archivePath)
      .filter((archivePath) => !archives.has(archivePath))
      .sort(),
    vanishedPages,
    unregisteredArchives: present.archives.filter((archive) => !registered.has(archive)).sort(),
    orphans: orphanPages(registry, present.wikiPages),
  };
}
