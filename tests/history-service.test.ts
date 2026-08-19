import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryService } from '../src/services/historyService.ts';

const roots: string[] = [];
const execFileAsync = promisify(execFile);

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-history-'));
  roots.push(root);
  await Promise.all(
    ['wiki', 'templates', 'build-context', 'deliverables', 'raw/ingested', '.wiki'].map((dir) =>
      mkdir(path.join(root, dir), { recursive: true }),
    ),
  );
  await writeFile(path.join(root, '.gitignore'), '.wikirc.yaml\n', 'utf8');
  return root;
}

describe('history service', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('initializes idempotently and commits only scoped workspace paths', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'wiki', 'existing.md'), '# Existing\n', 'utf8');
    const history = new HistoryService(root);
    const first = await history.initialize({ baseline: true });
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
    const second = await history.initialize({ baseline: true });
    expect(second.sha).toBeUndefined();

    await writeFile(path.join(root, 'wiki', 'page.md'), '# Page\n', 'utf8');
    await writeFile(path.join(root, 'private.txt'), 'do not track\n', 'utf8');
    const result = await history.commit({ command: 'build', runId: 'run-1' });
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.files).toEqual(['wiki/page.md']);
    const entries = await history.log({ file: 'wiki/page.md' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.runId).toBe('run-1');
    expect(await readFile(path.join(root, 'private.txt'), 'utf8')).toContain('do not');
  });

  it('keeps concurrent task commits disjoint when each declares its own scope', async () => {
    // Reproduces the orchestrated case: build/export lock scopes are per
    // template or per deliverable, so several `wiki export` processes write
    // this workspace at once. Without a scope, the first to take the history
    // lock committed every sibling's in-flight output under its own message
    // and the others produced no commit at all.
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        writeFile(path.join(root, 'deliverables', `d${n}.md`), `# livrable ${n}\n`, 'utf8'),
      ),
    );
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        history.commit({
          command: 'export',
          message: `export: deliverables/d${n}.md`,
          scope: [`deliverables/d${n}.md`],
        }),
      ),
    );

    // One commit per task, each holding exactly its own deliverable.
    expect(results.map((result) => result.files)).toEqual([
      ['deliverables/d1.md'],
      ['deliverables/d2.md'],
      ['deliverables/d3.md'],
      ['deliverables/d4.md'],
    ]);
    expect(new Set(results.map((result) => result.sha)).size).toBe(4);
    // One commit per task. (The baseline commit is empty here: the scaffold
    // directories exist but hold no file yet, so git records nothing.)
    const log = await history.log({ limit: 10 });
    expect(log).toHaveLength(4);
  });

  it('does not capture a sibling task in-flight file', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'deliverables', 'mine.md'), '# mine\n', 'utf8');
    await writeFile(path.join(root, 'deliverables', 'sibling.md'), '# PARTIAL WRITE\n', 'utf8');

    const result = await history.commit({
      command: 'export',
      message: 'export: deliverables/mine.md',
      scope: ['deliverables/mine.md'],
    });
    expect(result.files).toEqual(['deliverables/mine.md']);

    // The sibling's half-written file stays untracked, so a later restore of
    // this commit cannot revert work that was never part of it.
    const tracked = await execFileAsync('git', ['-C', root, 'ls-files']);
    expect(tracked.stdout).not.toContain('deliverables/sibling.md');
  });

  it('rejects a scope path outside the versioned workspace', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await expect(
      history.commit({ command: 'build', scope: ['../escape.md'] }),
    ).rejects.toThrow(/outside the versioned workspace scope|Invalid workspace path/);
    await expect(
      history.commit({ command: 'build', scope: ['.wikirc.yaml'] }),
    ).rejects.toThrow(/outside the versioned workspace scope/);
  });

  it('skips the manual pre-commit under orchestration but still commits the task output', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    // A sibling task is mid-write; a starting task must not file it as a
    // human edit.
    await writeFile(path.join(root, 'deliverables', 'sibling.md'), '# in flight\n', 'utf8');

    process.env.WIKI_RUN_ID = 'run-42';
    try {
      const prepared = await history.prepareRun('export');
      expect(prepared.sha).toBeUndefined();
      expect(prepared.warnings).toContain('history:orchestrated-run');

      await writeFile(path.join(root, 'deliverables', 'mine.md'), '# mine\n', 'utf8');
      const committed = await history.commit({
        command: 'export',
        scope: ['deliverables/mine.md'],
      });
      expect(committed.files).toEqual(['deliverables/mine.md']);
    } finally {
      delete process.env.WIKI_RUN_ID;
    }
  });

  it('restores a deliverable together with the build state that describes it', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    const state = (version: string) => ({
      deliverables: {
        'templates/note.md': {
          templateHash: version,
          wikiHash: version,
          buildContextHash: version,
          outputHash: version,
          outputRelativePath: 'deliverables/note.md',
        },
      },
    });
    await writeFile(path.join(root, 'deliverables', 'note.md'), '# v1\n', 'utf8');
    await writeFile(path.join(root, '.wiki', 'build-state.json'), `${JSON.stringify(state('v1'), null, 2)}\n`, 'utf8');
    const first = await history.commit({
      command: 'build',
      scope: ['deliverables/note.md', '.wiki/build-state.json'],
    });
    expect(first.files.sort()).toEqual(['.wiki/build-state.json', 'deliverables/note.md']);

    await writeFile(path.join(root, 'deliverables', 'note.md'), '# v2\n', 'utf8');
    await writeFile(path.join(root, '.wiki', 'build-state.json'), `${JSON.stringify(state('v2'), null, 2)}\n`, 'utf8');
    const second = await history.commit({
      command: 'build',
      scope: ['deliverables/note.md', '.wiki/build-state.json'],
    });

    await history.restoreRun(second.sha!);
    // Deliverable and build state move together, otherwise changedOnly would
    // consider the restored deliverable up to date and never rebuild it.
    expect(await readFile(path.join(root, 'deliverables', 'note.md'), 'utf8')).toBe('# v1\n');
    expect(JSON.parse(await readFile(path.join(root, '.wiki', 'build-state.json'), 'utf8'))).toEqual(state('v1'));
  });

  it('restores only the targeted build-state entries and preserves later builds', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    const entry = (outputRelativePath: string, version: string) => ({
      templateHash: version,
      wikiHash: version,
      buildContextHash: version,
      outputHash: version,
      outputRelativePath,
    });

    await writeFile(path.join(root, 'deliverables', 'alpha.md'), '# alpha\n', 'utf8');
    await writeFile(
      path.join(root, '.wiki', 'build-state.json'),
      `${JSON.stringify({ deliverables: { 'templates/alpha.md': entry('deliverables/alpha.md', 'a1') } }, null, 2)}\n`,
      'utf8',
    );
    const alpha = await history.commit({
      command: 'build',
      scope: ['deliverables/alpha.md', '.wiki/build-state.json'],
    });

    await writeFile(path.join(root, 'deliverables', 'beta.md'), '# beta\n', 'utf8');
    await writeFile(
      path.join(root, '.wiki', 'build-state.json'),
      `${JSON.stringify({
        deliverables: {
          'templates/alpha.md': entry('deliverables/alpha.md', 'a1'),
          'templates/beta.md': entry('deliverables/beta.md', 'b1'),
        },
      }, null, 2)}\n`,
      'utf8',
    );
    await history.commit({
      command: 'build',
      scope: ['deliverables/beta.md', '.wiki/build-state.json'],
    });

    await history.restoreRun(alpha.sha!);
    const restored = JSON.parse(
      await readFile(path.join(root, '.wiki', 'build-state.json'), 'utf8'),
    );
    expect(restored.deliverables['templates/alpha.md']).toBeUndefined();
    expect(restored.deliverables['templates/beta.md']).toEqual(
      entry('deliverables/beta.md', 'b1'),
    );
    expect(await readFile(path.join(root, 'deliverables', 'beta.md'), 'utf8')).toBe('# beta\n');
  });

  it('restores a restoration back to the original state', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'page.md'), '# v1\n', 'utf8');
    await history.commit({ command: 'build', scope: ['wiki/page.md'] });
    await writeFile(path.join(root, 'wiki', 'page.md'), '# v2\n', 'utf8');
    const second = await history.commit({ command: 'build', scope: ['wiki/page.md'] });

    const undo = await history.restoreRun(second.sha!);
    expect(await readFile(path.join(root, 'wiki', 'page.md'), 'utf8')).toBe('# v1\n');

    const redo = await history.restoreRun(undo.sha!);
    expect(await readFile(path.join(root, 'wiki', 'page.md'), 'utf8')).toBe('# v2\n');
    // Revert-forward: nothing was rewritten, every step is still in the log
    // (2 builds + 2 restorations).
    expect(redo.sha).not.toBe(second.sha);
    expect((await history.log({ limit: 20 })).length).toBe(4);
  });

  it('never tracks configuration secrets or runtime state', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, '.wikirc.yaml'), 'apiKey: s3cret\n', 'utf8');
    await writeFile(path.join(root, '.env'), 'TOKEN=s3cret\n', 'utf8');
    await mkdir(path.join(root, '.wiki', 'production-jobs'), { recursive: true });
    await writeFile(path.join(root, '.wiki', 'production-jobs', 'job.json'), '{}\n', 'utf8');
    await mkdir(path.join(root, 'raw', 'untracked'), { recursive: true });
    await writeFile(path.join(root, 'raw', 'untracked', 'source.md'), '# src\n', 'utf8');
    await writeFile(path.join(root, 'wiki', 'page.md'), '# Page\n', 'utf8');
    await history.commit({ command: 'ingest' });

    const tracked = (await execFileAsync('git', ['-C', root, 'ls-files'])).stdout;
    for (const forbidden of ['.wikirc.yaml', '.env', 'production-jobs', 'raw/untracked']) {
      expect(tracked).not.toContain(forbidden);
    }
    expect(tracked).toContain('wiki/page.md');
  });

  it('degrades when history is disabled without creating .git', async () => {
    const root = await workspace();
    const history = new HistoryService(root, { enabled: false });
    const result = await history.initialize({ baseline: true });
    expect(result.status.reason).toBe('disabled');
    await expect(readFile(path.join(root, '.git', 'HEAD'), 'utf8')).rejects.toThrow();
  });

  it('adopts a pre-existing repository without committing unrelated files', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'README.md'), 'user-owned\n', 'utf8');
    await execFileAsync('git', ['-C', root, 'init']);
    await execFileAsync('git', ['-C', root, 'add', '--', 'README.md']);
    await execFileAsync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '-m', 'user baseline']);
    const history = new HistoryService(root);
    const adopted = await history.initialize({ baseline: true });
    expect(adopted.sha).toBeUndefined();
    const userSha = (await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await expect(history.show(userSha, 'README.md')).rejects.toThrow('outside the versioned workspace scope');
    await expect(history.log({ file: 'README.md' })).rejects.toThrow('outside the versioned workspace scope');
    expect(await history.show(userSha)).not.toContain('user-owned');
    expect(await history.log()).toHaveLength(0);
    await writeFile(path.join(root, 'wiki', 'adopted.md'), '# Adopted\n', 'utf8');
    const result = await history.commit({ command: 'build' });
    expect(result.files).toEqual(['wiki/adopted.md']);
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('user-owned\n');
  });

  it('tags releases, filters history around them, and never rewrites history', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });

    for (const name of ['a', 'b', 'c', 'd']) {
      await writeFile(path.join(root, 'wiki', `${name}.md`), `# ${name}\n`, 'utf8');
      await history.commit({ command: 'build', scope: [`wiki/${name}.md`] });
    }

    // Auto-numbered release at HEAD (after d).
    const first = await history.createRelease();
    expect(first.name).toBe('release-1');
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/);

    await writeFile(path.join(root, 'wiki', 'e.md'), '# e\n', 'utf8');
    await history.commit({ command: 'build', scope: ['wiki/e.md'] });
    const labelled = await history.createRelease('stable');
    expect(labelled.name).toBe('release-stable');
    expect(await history.latestRelease()).toMatchObject({ name: 'release-stable' });

    // Nothing committed since release-stable yet.
    expect(await history.log({ since: 'release-stable' })).toHaveLength(0);

    await writeFile(path.join(root, 'wiki', 'f.md'), '# f\n', 'utf8');
    await history.commit({ command: 'build', scope: ['wiki/f.md'] });
    const since = await history.log({ since: 'release-stable' });
    expect(since).toHaveLength(1);

    // Commits reachable from release-1 (a..d) stay fully visible when asked.
    const before = await history.log({ until: 'release-1' });
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(await history.countLog('release-1')).toBe(before.length);

    // Auto-numbering resumes past labelled releases.
    expect((await history.createRelease()).name).toBe('release-2');

    // Releases must not rewrite history: a duplicate label is refused.
    await expect(history.createRelease('stable')).rejects.toThrow(/already exists/);
  });

  it('sanitizes an explicit release label to a path-safe name', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'wiki', 'existing.md'), '# Existing\n', 'utf8');
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    const release = await history.createRelease('My Release 1.0');
    expect(release.name).toBe('release-My-Release-1.0');
  });

  it('keeps the history implementation revert-forward only', async () => {
    const source = await Promise.all([
      readFile(new URL('../src/services/historyService.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/commands/restore.ts', import.meta.url), 'utf8'),
    ]).then((parts) => parts.join('\n'));
    expect(source).not.toMatch(/git[^\n]*(reset|rebase|push|amend)/i);
  });

  it('reads every commit of the log, not only the newest', async () => {
    /*
     `git log` separates its records with the format's %x1e AND its own newline
     between commits. Splitting on %x1e alone therefore left a leading "\n" on
     every entry but the first: their `sha` was unusable, so expanding or
     restoring anything below the top row failed — the first row worked, which
     is exactly what made the defect look like a UI quirk.
    */
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    for (const name of ['a', 'b', 'c']) {
      await writeFile(path.join(root, 'wiki', `${name}.md`), `# ${name}\n`, 'utf8');
      await history.commit({ command: 'build', message: `build: ${name}` });
    }

    const commits = await history.log({ limit: 10 });
    expect(commits.length).toBeGreaterThanOrEqual(3);
    for (const commit of commits) {
      expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(commit.shortSha).toMatch(/^[0-9a-f]{7,}$/);
    }
    // La preuve de bout en bout : chaque sha listé doit être lisible.
    for (const commit of commits) {
      await expect(history.show(commit.sha)).resolves.toEqual(expect.any(String));
    }
  });

  it('names an unresolvable commit instead of surfacing a raw git failure', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'wiki', 'existing.md'), '# Existing\n', 'utf8');
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });

    // `git show` on a stale sha fails with a bare "bad revision": the guard
    // turns it into a named error the reader can act on.
    await expect(history.show('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'))
      .rejects.toThrow('Unknown commit: deadbeefdead');
  });

  it('restores a file forward and records the restoration as a new commit', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'wiki', 'existing.md'), '# Existing\n', 'utf8');
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'page.md'), 'before\n', 'utf8');
    const first = await history.commit({ command: 'build' });
    await writeFile(path.join(root, 'wiki', 'page.md'), 'after\n', 'utf8');
    await history.commit({ command: 'build' });

    const restored = await history.restoreFile('wiki/page.md', first.sha!);
    expect(restored.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(path.join(root, 'wiki', 'page.md'), 'utf8')).toBe('before\n');
    expect(restored.sha).not.toBe(first.sha);
  });

  it('restores non-UTF8 bytes without transcoding them', async () => {
    const root = await workspace();
    const original = Buffer.from([0x23, 0x20, 0xe9, 0x0a, 0x00, 0xff]);
    await writeFile(path.join(root, 'raw', 'ingested', 'latin1.md'), original);
    const history = new HistoryService(root);
    const baseline = await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'raw', 'ingested', 'latin1.md'), Buffer.from('changed\n'));
    await history.commit({ command: 'build' });
    const restored = await history.restoreFile('raw/ingested/latin1.md', baseline.sha!);
    expect(restored.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(path.join(root, 'raw', 'ingested', 'latin1.md'))).toEqual(original);
  });

  it('commits and restores files whose names contain non-ASCII characters', async () => {
    // Git quotes non-ASCII filenames in its output (core.quotepath default),
    // e.g. `"wiki/concepts/exigences-imp\303\251ratives.md"`. Feeding those
    // quoted strings back as pathspecs made `git commit -- <files>` fail with
    // "pathspec did not match", so a workspace with an accented page name
    // could never restore (and could not even commit the accented file).
    const root = await workspace();
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    const page = 'wiki/concepts/exigences-impératives.md';
    await writeFile(path.join(root, page), '# v1\n', 'utf8');
    const first = await history.commit({ command: 'ingest' });
    expect(first.files).toEqual([page]);

    await writeFile(path.join(root, page), '# v2\n', 'utf8');
    const second = await history.commit({ command: 'ingest' });

    await history.restoreRun(second.sha!);
    expect(await readFile(path.join(root, page), 'utf8')).toBe('# v1\n');
  });

  it('preserves an ingested source before restoring a run that removed it', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'wiki', 'existing.md'), '# Existing\n', 'utf8');
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'raw', 'ingested', 'source.md'), '# Source\n', 'utf8');
    const ingest = await history.commit({ command: 'ingest' });

    const restored = await history.restoreRun(ingest.sha!);
    expect(restored.restoredFiles).toContain('raw/ingested/source.md');
    expect(await readFile(path.join(root, 'raw', 'untracked', 'source.md'), 'utf8')).toBe('# Source\n');
    await expect(readFile(path.join(root, 'raw', 'ingested', 'source.md'), 'utf8')).rejects.toThrow();
  });
});
