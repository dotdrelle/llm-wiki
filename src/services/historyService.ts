import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildStateSchema } from '../config/schema.ts';
import { pathExists, safeWriteFile, withFileLock } from '../utils/fs.ts';
import { normalizeSafeRelativePath, resolveInside } from '../utils/path.ts';
import type { BuildState, HistoryConfig } from '../types.ts';
import type { TraceLogger } from './traceLogger.ts';

const execFileAsync = promisify(execFile);
const HISTORY_LOCK_TTL_MS = 10 * 60 * 1000;

export const HISTORY_PATHS = [
  'wiki',
  'templates',
  'build-context',
  'deliverables',
  'raw/ingested',
  '.wiki/build-state.json',
] as const;

export interface HistoryMetadata {
  command: string;
  message?: string;
  runId?: string;
  taskId?: string;
  capability?: string;
  idempotencyKey?: string;
  /**
   * Workspace-relative paths actually produced by this command. When present,
   * only these are staged instead of the whole versioned scope.
   *
   * Required for every command the orchestrator may run concurrently in one
   * workspace (build, export, polish: their lock scopes are per-template or
   * per-deliverable, so several processes write the workspace at once).
   * Staging the whole scope makes the first process to reach the lock commit
   * its siblings' in-flight output under its own message, while the siblings
   * find an empty index and produce no commit at all.
   *
   * Commands serialized by the `workspace-write` lock (ingest, ingest_apply,
   * restore) may omit it — they are the only writer for their duration.
   */
  scope?: string[];
}

export interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  runId?: string;
  paths: string[];
}

export interface HistoryStatus {
  enabled: boolean;
  available: boolean;
  initialized: boolean;
  reason?: 'disabled' | 'git-missing' | 'not-initialized';
}

export interface HistoryResult {
  status: HistoryStatus;
  sha?: string;
  files: string[];
  warnings: string[];
}

interface GitOptions {
  allowFailure?: boolean;
}

const DEFAULT_CONFIG: HistoryConfig = {
  enabled: true,
  authorName: 'llm-wiki',
  authorEmail: 'llm-wiki@localhost',
};

function envMetadata(): Partial<HistoryMetadata> {
  return {
    runId: process.env.WIKI_RUN_ID,
    taskId: process.env.WIKI_TASK_ID,
    capability: process.env.WIKI_CAPABILITY,
    idempotencyKey: process.env.WIKI_IDEMPOTENCY_KEY,
  };
}

function quoteTrailer(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** True when the command runs as an orchestrated task rather than a direct CLI call. */
export function isOrchestratedRun(): boolean {
  return Boolean(process.env.WIKI_RUN_ID);
}

function isHistoryPath(file: string): boolean {
  return HISTORY_PATHS.some((scope) => file === scope || file.startsWith(`${scope}/`));
}

function normalizeHistoryPath(file: string): string {
  const normalized = normalizeSafeRelativePath(file.trim().replace(/^\.\//, ''));
  if (!normalized) throw new Error(`Invalid workspace path: ${file}`);
  if (!isHistoryPath(normalized)) {
    throw new Error(`Path is outside the versioned workspace scope: ${file}`);
  }
  return normalized;
}

function scopedHistoryPath(file: string): string | undefined {
  try {
    return normalizeHistoryPath(file);
  } catch {
    return undefined;
  }
}

export class HistoryService {
  private readonly rootDir: string;
  private readonly config: HistoryConfig;
  private readonly lockPath: string;
  private readonly buildStateLockPath: string;
  private gitAvailable?: boolean;

  constructor(rootDir: string, config?: Partial<HistoryConfig>) {
    this.rootDir = path.resolve(rootDir);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lockPath = path.join(this.rootDir, '.wiki', 'history.lock');
    this.buildStateLockPath = path.join(this.rootDir, '.wiki', 'build-state.lock');
  }

  private async git(args: string[], options: GitOptions = {}): Promise<string> {
    try {
      const result = await execFileAsync(
        'git',
        [
          '-c',
          `user.name=${this.config.authorName}`,
          '-c',
          `user.email=${this.config.authorEmail}`,
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.autocrlf=false',
          '-c',
          `safe.directory=${this.rootDir}`,
          '-C',
          this.rootDir,
          ...args,
        ],
        {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      return result.stdout.trim();
    } catch (error) {
      if (options.allowFailure) return '';
      throw error;
    }
  }

  private async gitRaw(args: string[]): Promise<string> {
    const result = await execFileAsync(
      'git',
      [
        '-c', `user.name=${this.config.authorName}`,
        '-c', `user.email=${this.config.authorEmail}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.autocrlf=false',
        '-c', `safe.directory=${this.rootDir}`,
        '-C', this.rootDir,
        ...args,
      ],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 },
    );
    return result.stdout;
  }

  private async gitRawBuffer(args: string[]): Promise<Buffer> {
    const result = await execFileAsync(
      'git',
      [
        '-c', `user.name=${this.config.authorName}`,
        '-c', `user.email=${this.config.authorEmail}`,
        '-c', 'commit.gpgsign=false',
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.autocrlf=false',
        '-c', `safe.directory=${this.rootDir}`,
        '-C', this.rootDir,
        ...args,
      ],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' as const },
    );
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
  }

  private async readTreeBuildState(tree: string): Promise<BuildState> {
    const raw = await this.git(
      ['show', '--format=', `${tree}:.wiki/build-state.json`],
      { allowFailure: true },
    );
    return raw ? buildStateSchema.parse(JSON.parse(raw)) : { deliverables: {} };
  }

  private async restoreBuildStateEntries(targetTree: string, sourceTree: string): Promise<void> {
    const [target, source] = await Promise.all([
      this.readTreeBuildState(targetTree),
      this.readTreeBuildState(sourceTree),
    ]);
    let current: BuildState = { deliverables: {} };
    if (await pathExists(path.join(this.rootDir, '.wiki', 'build-state.json'))) {
      current = buildStateSchema.parse(
        JSON.parse(await readFile(path.join(this.rootDir, '.wiki', 'build-state.json'), 'utf8')),
      );
    }
    const changedTemplates = new Set([
      ...Object.keys(target.deliverables),
      ...Object.keys(source.deliverables),
    ].filter(
      (template) => JSON.stringify(target.deliverables[template]) !== JSON.stringify(source.deliverables[template]),
    ));
    const merged: BuildState = { deliverables: { ...current.deliverables } };
    for (const template of changedTemplates) {
      const restored = target.deliverables[template];
      if (restored) merged.deliverables[template] = restored;
      else delete merged.deliverables[template];
    }
    await safeWriteFile(
      path.join(this.rootDir, '.wiki', 'build-state.json'),
      `${JSON.stringify(merged, null, 2)}\n`,
    );
  }

  async status(): Promise<HistoryStatus> {
    if (!this.config.enabled) {
      return { enabled: false, available: false, initialized: false, reason: 'disabled' };
    }
    if (this.gitAvailable === false) {
      return { enabled: true, available: false, initialized: false, reason: 'git-missing' };
    }
    try {
      await this.git(['--version']);
      this.gitAvailable = true;
    } catch {
      this.gitAvailable = false;
      return { enabled: true, available: false, initialized: false, reason: 'git-missing' };
    }
    const initialized = Boolean(await this.git(['rev-parse', '--git-dir'], { allowFailure: true }));
    return initialized
      ? { enabled: true, available: true, initialized: true }
      : { enabled: true, available: true, initialized: false, reason: 'not-initialized' };
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(this.lockPath, operation, { ttlMs: HISTORY_LOCK_TTL_MS });
  }

  async initialize(options: { baseline?: boolean } = {}): Promise<HistoryResult> {
    const status = await this.status();
    if (!status.enabled || !status.available) {
      return { status, files: [], warnings: status.reason ? [`history:${status.reason}`] : [] };
    }
    return this.withLock(async () => {
      let initialized = status.initialized;
      if (!initialized) {
        await this.git(['init']);
        initialized = true;
      }
      if (!(await pathExists(path.join(this.rootDir, '.gitignore')))) {
        await writeFile(path.join(this.rootDir, '.gitignore'), '', 'utf8');
      }
      const current = await readFile(path.join(this.rootDir, '.gitignore'), 'utf8');
      const additions = ['.wiki/production-jobs/', '.wiki/history.lock', '.wiki/build-state.lock', 'raw/untracked/'].filter(
        (entry) => !current.split(/\r?\n/).includes(entry),
      );
      if (additions.length > 0) {
        await appendFile(
          path.join(this.rootDir, '.gitignore'),
          `${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${additions.join('\n')}\n`,
          'utf8',
        );
      }
      if (!options.baseline || status.initialized) {
        return { status: { enabled: true, available: true, initialized }, files: [], warnings: [] };
      }
      return this.commitLocked({ command: 'baseline', message: 'chore: initialize workspace history' });
    });
  }

  private async commitLocked(metadata: HistoryMetadata): Promise<HistoryResult> {
    const status = await this.status();
    if (!status.initialized) {
      return { status, files: [], warnings: ['history:not-initialized'] };
    }
    const requested = metadata.scope?.length
      ? [...new Set(metadata.scope.map((entry) => normalizeHistoryPath(entry)))]
      : [...HISTORY_PATHS];
    // Staging a path git has never seen and that no longer exists on disk is a
    // hard error ("pathspec did not match any files"), which would turn a
    // successful build into a failed command.
    const paths: string[] = (
      await Promise.all(
        requested.map(async (entry) =>
          (await pathExists(path.join(this.rootDir, entry))) ||
          (await this.git(['ls-files', '--', entry], { allowFailure: true }))
            ? entry
            : undefined,
        ),
      )
    ).filter((entry): entry is string => Boolean(entry));
    if (paths.length > 0) {
      await this.git(['add', '--all', '--', ...paths]);
    }
    // Restricted to the staged scope: a sibling task may have staged nothing
    // here, but concurrent writes elsewhere must not leak into this commit.
    const changed = paths.length > 0
      ? await this.git(['diff', '--cached', '--name-only', '--', ...paths])
      : '';
    const files = changed ? changed.split('\n').filter(Boolean) : [];
    if (files.length === 0) {
      return { status, files: [], warnings: [] };
    }
    const merged: Partial<HistoryMetadata> = { ...envMetadata() };
    for (const [key, value] of Object.entries(metadata) as Array<[
      keyof HistoryMetadata,
      string | undefined,
    ]>) {
      if (key !== 'scope' && value !== undefined) merged[key] = value;
    }
    const message = `${metadata.message ?? `${metadata.command}: workspace update`}\n\nWiki-Command: ${quoteTrailer(metadata.command)}\n${merged.runId ? `Wiki-Run-Id: ${quoteTrailer(merged.runId)}\n` : ''}${merged.taskId ? `Wiki-Task-Id: ${quoteTrailer(merged.taskId)}\n` : ''}${merged.capability ? `Wiki-Capability: ${quoteTrailer(merged.capability)}\n` : ''}${merged.idempotencyKey ? `Wiki-Idempotency-Key: ${quoteTrailer(merged.idempotencyKey)}\n` : ''}`;
    // Restricted to the files this command actually staged, not to `paths`:
    // a scope entry may be a directory git has nothing under yet, which would
    // fail the pathspec. Committing the exact file list keeps a concurrent
    // sibling's staged work out of this commit either way.
    await this.git(['commit', '-m', message, '--', ...files]);
    const sha = await this.git(['rev-parse', 'HEAD']);
    return { status, sha, files, warnings: [] };
  }

  async commit(metadata: HistoryMetadata): Promise<HistoryResult> {
    const status = await this.status();
    if (!status.enabled || !status.available || !status.initialized) {
      return { status, files: [], warnings: status.reason ? [`history:${status.reason}`] : [] };
    }
    return this.withLock(() => this.commitLocked(metadata));
  }

  /**
   * Commit edits that predate a run, so a later restore only reverts the run.
   *
   * Never runs under orchestration: with several tasks writing the same
   * workspace concurrently, a starting task cannot tell a human edit from a
   * sibling's in-flight output, and would file the sibling's legitimate work
   * under "manual changes". Orchestrated commands stage their own outputs
   * only (see HistoryMetadata.scope), so pre-existing edits stay untouched
   * instead of being absorbed.
   */
  async prepareRun(command: string): Promise<HistoryResult> {
    const status = await this.status();
    if (!status.enabled || !status.available || !status.initialized) {
      return { status, files: [], warnings: status.reason ? [`history:${status.reason}`] : [] };
    }
    if (isOrchestratedRun()) {
      return { status, files: [], warnings: ['history:orchestrated-run'] };
    }
    return this.withLock(async () => {
      const dirty = await this.git(['status', '--porcelain', '--', ...HISTORY_PATHS]);
      if (!dirty) return { status, files: [], warnings: [] };
      return this.commitLocked({
        command: 'manual',
        message: `chore: manual changes before ${command}`,
      });
    });
  }

  async log(options: { file?: string; limit?: number } = {}): Promise<HistoryCommit[]> {
    const status = await this.status();
    if (!status.initialized) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    const paths = options.file ? [normalizeHistoryPath(options.file)] : [...HISTORY_PATHS];
    const raw = await this.git([
      'log',
      `-${limit}`,
      '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%(trailers:key=Wiki-Run-Id,valueonly)%x1e',
      '--',
      ...paths,
    ]);
    return raw
      .split('\x1e')
      .filter(Boolean)
      .map((entry) => {
        const [sha, shortSha, subject, author, date, runId] = entry.split('\x1f');
        return {
          sha,
          shortSha,
          subject,
          author,
          date,
          runId: runId?.trim() || undefined,
          paths: [],
        };
      });
  }

  async show(sha: string, file?: string): Promise<string> {
    const status = await this.status();
    if (!status.initialized) throw new Error('Workspace history is not initialized.');
    const normalized = file ? normalizeHistoryPath(file) : undefined;
    return normalized
      ? this.gitRaw(['show', '--format=', `${sha}:${normalized}`])
      : this.gitRaw(['show', '--format=', sha, '--', ...HISTORY_PATHS]);
  }

  async restoreFile(
    file: string,
    sha: string,
    options: { dryRun?: boolean } = {},
  ): Promise<HistoryResult & { content?: string; existed: boolean }> {
    const status = await this.status();
    if (!status.initialized) throw new Error('Workspace history is not initialized.');
    const normalized = normalizeHistoryPath(file);
    let exists = true;
    try {
      await this.git(['cat-file', '-e', `${sha}:${normalized}`]);
    } catch {
      exists = false;
    }
    const contentBuffer = exists ? await this.gitRawBuffer(['show', '--format=', `${sha}:${normalized}`]) : undefined;
    const content = contentBuffer?.toString('utf8');
    if (options.dryRun) {
      return { status, files: exists ? [normalized] : [], warnings: [], content, existed: exists };
    }
    const restore = () => this.withLock(async () => {
      const absolute = resolveInside(this.rootDir, normalized);
      if (exists) {
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, contentBuffer ?? Buffer.alloc(0));
      } else if (await pathExists(absolute)) {
        await unlink(absolute);
      }
      const result = await this.commitLocked({
        command: 'restore_file',
        message: `restore: ${normalized} to ${sha.slice(0, 12)}`,
      });
      return { ...result, content, existed: exists };
    });
    return normalized === '.wiki/build-state.json'
      ? withFileLock(this.buildStateLockPath, restore)
      : restore();
  }

  async restoreRun(
    sha: string,
    options: { dryRun?: boolean } = {},
  ): Promise<HistoryResult & { restoredFiles: string[] }> {
    const status = await this.status();
    if (!status.initialized) throw new Error('Workspace history is not initialized.');
    // A run rollback means reverting the run commit to its first parent. The
    // target commit itself is the state after the run, not the state to restore.
    const parent = (await this.git(['rev-parse', `${sha}^`], { allowFailure: true })) || undefined;
    const targetTree = parent ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const changed = (await this.git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha]))
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const paths = changed
      .map(scopedHistoryPath)
      .filter((entry): entry is string => Boolean(entry));
    if (options.dryRun) {
      return { status, files: paths, restoredFiles: paths, warnings: [] };
    }
    const restore = () => this.withLock(async () => {
      const warnings: string[] = [];
      for (const relative of paths) {
        if (relative === '.wiki/build-state.json') {
          await this.restoreBuildStateEntries(targetTree, sha);
          continue;
        }
        const absolute = resolveInside(this.rootDir, relative);
        let exists = true;
        try {
          await this.git(['cat-file', '-e', `${targetTree}:${relative}`]);
        } catch {
          exists = false;
        }
        if (relative.startsWith('raw/ingested/') && !exists && (await pathExists(absolute))) {
          const targetDir = path.join(this.rootDir, 'raw', 'untracked');
          await mkdir(targetDir, { recursive: true });
          const base = path.basename(relative);
          const stem = path.basename(base, path.extname(base));
          const extension = path.extname(base);
          let target = path.join(targetDir, base);
          let suffix = 1;
          while (await pathExists(target)) {
            target = path.join(targetDir, `${stem}.restored-${suffix}${extension}`);
            suffix += 1;
          }
          await copyFile(absolute, target);
          warnings.push(`source preserved at ${path.relative(this.rootDir, target)}`);
        }
        if (exists) {
          const content = await this.gitRawBuffer(['show', '--format=', `${targetTree}:${relative}`]);
          await mkdir(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, content);
        } else if (await pathExists(absolute)) {
          await unlink(absolute);
        }
      }
      const result = await this.commitLocked({
        command: 'restore_run',
        message: `restore: run ${sha.slice(0, 12)}`,
      });
      return { ...result, restoredFiles: paths, warnings };
    });
    return paths.includes('.wiki/build-state.json')
      ? withFileLock(this.buildStateLockPath, restore)
      : restore();
  }
}

export function historyLoggerWarning(logger: TraceLogger | undefined, result: HistoryResult): Promise<void> | undefined {
  const warning = result.warnings[0];
  return warning ? logger?.warn('history:skip', { reason: warning.replace(/^history:/, '') }) : undefined;
}

export async function commitHistorySafely(
  history: HistoryService,
  metadata: HistoryMetadata,
  logger?: TraceLogger,
): Promise<HistoryResult> {
  try {
    const result = await history.commit(metadata);
    await historyLoggerWarning(logger, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger?.warn('history:skip', { reason: 'commit-failed', message });
    console.warn(`Warning: workspace history commit skipped: ${message}`);
    return {
      status: { enabled: true, available: true, initialized: true },
      files: [],
      warnings: [`history:commit-failed:${message}`],
    };
  }
}

export async function prepareHistorySafely(
  history: HistoryService,
  command: string,
  logger?: TraceLogger,
): Promise<HistoryResult> {
  try {
    const result = await history.prepareRun(command);
    await historyLoggerWarning(logger, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger?.warn('history:skip', { reason: 'precommit-failed', message });
    console.warn(`Warning: workspace history pre-commit skipped: ${message}`);
    return {
      status: { enabled: true, available: true, initialized: true },
      files: [],
      warnings: [`history:precommit-failed:${message}`],
    };
  }
}
