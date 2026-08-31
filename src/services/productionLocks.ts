import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { pathExists } from '../utils/fs.ts';

/**
 * Read-only view of the production agent's lock directory.
 *
 * `agent-production` serializes its jobs with lock files under
 * `<workspace>/.wiki/production-jobs/locks/<workspace>/*.lock`, and the
 * llm-wiki container mounts the very same workspace. We never write there:
 * the agent owns those files. We only need to answer one question before
 * touching `templates/` or `build-context/` — is a job holding the workspace
 * right now?
 *
 * Why this matters, concretely: `_job_lock_scopes()` on the agent side derives
 * a `deliverable:<output>` scope by reading the template's `output`
 * frontmatter *at the moment it takes the lock*. Rewriting that frontmatter
 * mid-run leaves the job holding a lock on the old deliverable while it writes
 * to the new one, and two concurrent jobs can then target the same file
 * without any conflict being detected. Refusing the write is the cheap half of
 * the fix, and the only half that belongs in this repository.
 */

const LOCKS_SUBPATH = path.join('.wiki', 'production-jobs', 'locks');
const JOBS_SUBPATH = path.join('.wiki', 'production-jobs', 'jobs');

/** Job states the agent itself treats as holding their locks. */
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);

export interface ProductionLock {
  jobId: string;
  scopes: string[];
  createdAt?: string;
  lockFile: string;
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * A lock file alone does not prove a job is alive: the agent clears stale
 * locks lazily, on its next scan, using an in-process task table we cannot
 * see from here. The job record is the only cross-process evidence available,
 * so an orphaned lock whose job is already terminal is ignored rather than
 * blocking writes forever.
 */
export async function listActiveProductionLocks(rootDir: string): Promise<ProductionLock[]> {
  const locksDir = path.join(rootDir, LOCKS_SUBPATH);
  if (!(await pathExists(locksDir))) return [];

  const lockFiles = await fg('**/*.lock', {
    cwd: locksDir,
    absolute: true,
    onlyFiles: true,
  });

  const locks: ProductionLock[] = [];
  for (const lockFile of lockFiles.sort()) {
    const lock = await readJson(lockFile);
    const jobId = typeof lock?.jobId === 'string' ? lock.jobId : '';
    if (!jobId) continue;

    const job = await readJson(path.join(rootDir, JOBS_SUBPATH, `${jobId}.json`));
    // No job record at all: the agent may have just created the lock and not
    // yet flushed the job, so treat it as active. Erring toward refusing a
    // write is recoverable; erring toward writing during a run is not.
    const status = typeof job?.status === 'string' ? job.status.toLowerCase() : '';
    if (status && !ACTIVE_JOB_STATUSES.has(status)) continue;

    const rawScopes = Array.isArray(lock?.scopes) ? lock.scopes : [lock?.scope];
    locks.push({
      jobId,
      scopes: rawScopes.filter((item): item is string => typeof item === 'string'),
      createdAt: typeof lock?.createdAt === 'string' ? lock.createdAt : undefined,
      lockFile,
    });
  }
  return locks;
}

export interface ProductionBusyReport {
  busy: boolean;
  locks: ProductionLock[];
  message?: string;
}

/**
 * Deliberately coarse: any active job blocks any template or build-context
 * write, without trying to match scopes. A finer rule would have to replicate
 * `_conflicting_lock()` and `_template_deliverable_scope()` — including the
 * frontmatter read that is itself the race we are closing. Coarse and correct
 * beats precise and subtly wrong; template authoring is not on a hot path.
 */
export async function checkProductionIdle(rootDir: string): Promise<ProductionBusyReport> {
  const locks = await listActiveProductionLocks(rootDir);
  if (locks.length === 0) return { busy: false, locks: [] };
  const jobs = [...new Set(locks.map((lock) => lock.jobId))];
  const scopes = [...new Set(locks.flatMap((lock) => lock.scopes))];
  return {
    busy: true,
    locks,
    message:
      `Refused: a production job is active (job ${jobs.join(', ')}; ` +
      `scope ${scopes.join(', ') || 'workspace-write'}). Writing to templates/ or ` +
      'build-context/ during a run can make the job build content it never locked. ' +
      'Wait for the job to finish, or cancel it, then retry.',
  };
}
