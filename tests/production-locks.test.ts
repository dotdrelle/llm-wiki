import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkProductionAllowsWrite, checkProductionIdle } from '../src/services/productionLocks.ts';

// The production agent clears its stale locks lazily, using an in-process task
// table this repository cannot see. The job record is the only cross-process
// evidence, so these tests pin the two directions that matter: an active job
// blocks writes, a terminal one never does.

const created: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-locks-'));
  created.push(root);
  return root;
}

async function writeLock(root: string, jobId: string, scopes: string[]): Promise<void> {
  const locksDir = path.join(root, '.wiki', 'production-jobs', 'locks', 'ws');
  await mkdir(locksDir, { recursive: true });
  await writeFile(
    path.join(locksDir, `${jobId}.lock`),
    JSON.stringify({ workspace: 'ws', jobId, scopes, createdAt: '2026-08-06T10:00:00Z' }),
    'utf8',
  );
}

async function writeJob(root: string, jobId: string, status: string): Promise<void> {
  const jobsDir = path.join(root, '.wiki', 'production-jobs', 'jobs');
  await mkdir(jobsDir, { recursive: true });
  await writeFile(path.join(jobsDir, `${jobId}.json`), JSON.stringify({ jobId, status }), 'utf8');
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('checkProductionIdle', () => {
  it('reports idle when there is no lock directory at all', async () => {
    const root = await makeWorkspace();
    await expect(checkProductionIdle(root)).resolves.toMatchObject({ busy: false });
  });

  it('reports busy while a job is running, naming the job and its scopes', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-1', ['deliverable:deliverables/notes/basic-note.md']);
    await writeJob(root, 'job-1', 'running');

    const report = await checkProductionIdle(root);
    expect(report.busy).toBe(true);
    expect(report.locks[0]?.jobId).toBe('job-1');
    expect(report.message).toContain('job-1');
    expect(report.message).toContain('deliverable:deliverables/notes/basic-note.md');
  });

  it('treats queued and cancelling jobs as still holding the workspace', async () => {
    for (const status of ['queued', 'cancelling']) {
      const root = await makeWorkspace();
      await writeLock(root, 'job-2', ['workspace-write']);
      await writeJob(root, 'job-2', status);
      await expect(checkProductionIdle(root)).resolves.toMatchObject({ busy: true });
    }
  });

  it('ignores an orphaned lock whose job already finished', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-3', ['workspace-write']);
    await writeJob(root, 'job-3', 'done');
    await expect(checkProductionIdle(root)).resolves.toMatchObject({ busy: false });
  });

  it('errs toward busy when the lock exists but the job record does not yet', async () => {
    // The agent writes the lock before flushing the job. Refusing a write here
    // is recoverable; writing during a run is not.
    const root = await makeWorkspace();
    await writeLock(root, 'job-4', ['workspace-write']);
    await expect(checkProductionIdle(root)).resolves.toMatchObject({ busy: true });
  });
});

async function writeTypedJob(root: string, jobId: string, type: string, steps: string[]): Promise<void> {
  const jobsDir = path.join(root, '.wiki', 'production-jobs', 'jobs');
  await mkdir(jobsDir, { recursive: true });
  await writeFile(
    path.join(jobsDir, `${jobId}.json`),
    JSON.stringify({ jobId, status: 'running', type, steps: steps.map((name) => ({ name, status: 'running' })) }),
    'utf8',
  );
}

// plan-demandes-pendant-run.md, lot 3: what a job DOES decides which direct
// write it refuses, instead of "any active job refuses every write".
describe('checkProductionAllowsWrite', () => {
  it('lets a template be written during a plain ingest', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-ingest', ['workspace-write']);
    await writeTypedJob(root, 'job-ingest', 'ingest_apply', ['ingest_apply']);
    await expect(checkProductionAllowsWrite(root, 'assets')).resolves.toMatchObject({ busy: false });
  });

  it('refuses a wiki page while the ingest writes the wiki, naming the job and what it does', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-ingest', ['workspace-write']);
    await writeTypedJob(root, 'job-ingest', 'ingest_apply', ['ingest_apply']);
    const report = await checkProductionAllowsWrite(root, 'wiki');
    expect(report.busy).toBe(true);
    expect(report.message).toContain('job-ingest');
    expect(report.message).toContain('ingest_apply');
    expect(report.locks[0]?.operations).toEqual(['ingest_apply']);
  });

  it('refuses a template while a build or a pipeline reads them, and allows a wiki page during a build', async () => {
    for (const [type, steps] of [['build', ['build']], ['pipeline', ['ingest', 'build', 'export']]] as const) {
      const root = await makeWorkspace();
      await writeLock(root, `job-${type}`, ['workspace-write']);
      await writeTypedJob(root, `job-${type}`, type, [...steps]);
      await expect(checkProductionAllowsWrite(root, 'assets')).resolves.toMatchObject({ busy: true });
    }
    const root = await makeWorkspace();
    await writeLock(root, 'job-build', ['deliverable:deliverables/a.md']);
    await writeTypedJob(root, 'job-build', 'build', ['build']);
    await expect(checkProductionAllowsWrite(root, 'wiki')).resolves.toMatchObject({ busy: false });
  });

  it('still refuses both while the job record is not flushed yet', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-new', ['workspace-write']);
    await expect(checkProductionAllowsWrite(root, 'wiki')).resolves.toMatchObject({ busy: true });
    await expect(checkProductionAllowsWrite(root, 'assets')).resolves.toMatchObject({ busy: true });
  });

  it('ignores a finished job for both targets', async () => {
    const root = await makeWorkspace();
    await writeLock(root, 'job-done', ['workspace-write']);
    await writeJob(root, 'job-done', 'done');
    await expect(checkProductionAllowsWrite(root, 'wiki')).resolves.toMatchObject({ busy: false });
  });
});
