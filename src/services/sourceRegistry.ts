import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Source provenance registry.
 *
 * **Write-only at this stage.** Nothing reads it, nothing relies on it, and its
 * absence or corruption cannot fail an ingestion. This is deliberate: it is the
 * T32.2 step of the lifecycle (`docs/content-lifecycle.md`), which makes the
 * problem observable before trying to solve it. A reconciliation pass cannot be
 * written without data to reconcile, and fabricating the data and the decision
 * in the same batch would make each of them unverifiable.
 *
 * What it answers, once populated: which sources exist, when each was last seen,
 * and **which pages it really produced** — not what the model proposed, but what
 * was applied.
 */

export const SOURCE_REGISTRY_VERSION = 1;

/** Registry file name, shared by the writer and the re-anchoring reader. */
export const SOURCE_REGISTRY_FILENAME = 'source-registry.json';

export type SourceStatus = 'active' | 'missing' | 'retracted';

export type SourceRecord = {
  /**
   * Stable identity of the source. See `docs/content-lifecycle.md` § 4.1:
   * eventually provided by the producer (`confluence:page:123`). Until a
   * producer provides it, it derives from the archive path — in which case an
   * upstream rename does create a new source, which the registry is precisely
   * meant to make visible.
   */
  sourceId: string;
  archivePath: string;
  contentHash: string;
  status: SourceStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIngestedAt: string | null;
  /** Pages actually created or updated by this source. */
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
 * Reads the registry. An absent, unreadable or unknown-version file yields an
 * empty registry rather than an error: this file is an observation, and a
 * failed observation must never interrupt the work it observes.
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

/** Atomic write: a truncated file would be worse than an absent one. */
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
  /** Pages applied during this ingestion. Empty for an unchanged source. */
  producedPages?: string[];
  /** False for a source seen but not re-ingested (`unchanged since last ingest`). */
  ingested: boolean;
  observedAt: string;
};

/**
 * Records a source as it has just been seen.
 *
 * Pure function: it returns a new registry, it writes nothing. That is what
 * lets it be tested without a filesystem, and re-read without wondering what
 * else it touches.
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
        // Seeing a source again brings it back to `active`: that is the
        // `missing → active` transition of the specification, and it is free
        // here.
        status: 'active',
        lastSeenAt: observation.observedAt,
        lastIngestedAt: observation.ingested ? observation.observedAt : source.lastIngestedAt,
        // An unchanged source produces nothing: keep the old list rather than
        // overwriting it with an empty array, otherwise a simple re-archiving
        // would erase the trace of everything the source had produced.
        producedPages: observation.ingested
          ? [...new Set(observation.producedPages ?? [])].sort()
          : source.producedPages,
      };
    }),
  };
}

/**
 * Wiki pages that no living source backs.
 *
 * An orphan page is not necessarily wrong: it may have been written by hand, or
 * produced before the registry existed. It is a question asked to the operator,
 * never a deletion.
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
  /** Archives vanished from disk although the registry knows them. */
  vanishedArchives: string[];
  /** Pages a source produced and that no longer exist. */
  vanishedPages: Array<{ sourceId: string; pages: string[] }>;
  /** Archives present on disk that no registry entry covers. */
  unregisteredArchives: string[];
  /** Wiki pages that no living source backs. */
  orphans: string[];
};

export function isReportClean(report: ReconciliationReport): boolean {
  return report.vanishedArchives.length === 0
    && report.vanishedPages.length === 0
    && report.unregisteredArchives.length === 0
    && report.orphans.length === 0;
}

/**
 * Compares the registry to what actually exists on disk.
 *
 * **Reports, writes nothing, recreates nothing.** A page deleted by hand is a
 * decision: making it reappear would contradict it, and deleting it elsewhere
 * without saying so would be worse. The only defensible behaviour until
 * withdrawal is specified end to end (T32.4) is to name the gap.
 *
 * Pure function: the caller provides the inventories. That is what makes it
 * testable on cases that the filesystem would make tedious to set up.
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
