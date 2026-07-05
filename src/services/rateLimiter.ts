import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { TraceLogger } from './traceLogger.ts';
import type { TraceProviderKind } from './traceLogger.ts';

const rateLimiterQueues = new Map<string, Promise<void>>();
const rateLimiterStarts = new Map<string, number[]>();
const sharedRateLimitDirs = new Set<string>();
const SHARED_RATE_LIMIT_LOCK_STALE_MS = 30_000;

interface SharedRateLimitBucket {
  version?: number;
  key?: string;
  starts?: unknown;
}

interface ProviderThrottleOptions {
  key: string;
  requestsPerMinute: number;
  logger?: TraceLogger;
  label?: string;
  workspaceRoot?: string;
}

function requestWindowMs(): number {
  const override = Number(process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(override) && override > 0 ? override : 60_000;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function effectiveRequestsPerMinute(requestsPerMinute: number): number {
  const configured = Math.max(1, Math.floor(requestsPerMinute));
  const share = Number(process.env.WIKI_RPM_SHARE);
  if (!Number.isFinite(share) || share <= 0) return configured;
  return Math.max(1, Math.min(configured, Math.floor(share)));
}

function providerKindFromLabel(label?: string): TraceProviderKind {
  if (label === 'embedding') return 'embedding';
  if (label === 'rerank') return 'rerank';
  return 'llm';
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get: (key: string) => unknown }).get(name);
    return typeof value === 'string' ? value : undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return typeof value === 'string' ? value : undefined;
}

export function providerRateLimitRetryMaxAttempts(): number {
  return readPositiveIntegerEnv('LLM_WIKI_RATE_LIMIT_RETRY_MAX_ATTEMPTS', 3);
}

export function pruneWindowTimestamps(
  timestamps: number[],
  now: number,
  windowMs: number,
): number[] {
  const threshold = now - windowMs;
  return timestamps.filter((startedAt) => startedAt > threshold);
}

function pruneStarts(key: string, now: number, windowMs: number): number[] {
  const starts = pruneWindowTimestamps(rateLimiterStarts.get(key) ?? [], now, windowMs);
  rateLimiterStarts.set(key, starts);
  return starts;
}

function recordLocalStart(key: string, startedAt: number, windowMs: number): void {
  const starts = pruneWindowTimestamps(
    rateLimiterStarts.get(key) ?? [],
    startedAt,
    windowMs,
  );
  starts.push(startedAt);
  rateLimiterStarts.set(key, starts);
}

function localWindowRemainingMs(key: string): number | undefined {
  const windowMs = requestWindowMs();
  const now = Date.now();
  const starts = pruneStarts(key, now, windowMs);
  const oldest = starts[0];
  if (oldest === undefined) return undefined;
  const remainingMs = oldest + windowMs - now;
  if (remainingMs <= 0) return undefined;
  return (
    remainingMs + readPositiveIntegerEnv('LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS', 1_000)
  );
}

function retryFallbackMs(): number {
  return readPositiveIntegerEnv('LLM_WIKI_RATE_LIMIT_RETRY_MS', requestWindowMs());
}

export function providerRateLimitRetryDelayMs(options: {
  key: string;
  source?: { headers?: unknown };
}): number {
  const retryAfter = headerValue(options.source?.headers, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return localWindowRemainingMs(options.key) ?? retryFallbackMs();
}

export async function waitForProviderRateLimitRetry(options: {
  logger?: TraceLogger;
  event: string;
  label?: string;
  status?: number;
  attempt: number;
  maxAttempts: number;
  waitMs: number;
  traceData?: Record<string, unknown>;
}): Promise<void> {
  const retryAt = new Date(Date.now() + options.waitMs).toISOString();
  await options.logger?.warn(options.event, {
    label: options.label,
    status: options.status,
    attempt: options.attempt,
    maxAttempts: options.maxAttempts,
    waitMs: options.waitMs,
    retryAt,
    ...options.traceData,
  });
  options.logger?.recordProviderMetric?.({
    kind: providerKindFromLabel(options.label),
    throttleMs: options.waitMs,
  });
  await new Promise((resolve) => setTimeout(resolve, options.waitMs));
}

function sharedRateLimitDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.wiki', 'rate-limit');
}

function sharedRateLimitPath(workspaceRoot: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return path.join(sharedRateLimitDir(workspaceRoot), `${digest}.json`);
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + Math.max(1_000, requestWindowMs());
  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const details = await stat(lockPath);
        if (Date.now() - details.mtimeMs > SHARED_RATE_LIMIT_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for rate-limit lock ${lockPath}`);
      }
      await sleep(10);
    }
  }
}

async function readSharedStarts(
  filePath: string,
  key: string,
  now: number,
  windowMs: number,
): Promise<number[]> {
  try {
    const bucket = JSON.parse(await readFile(filePath, 'utf8')) as SharedRateLimitBucket;
    if (bucket.version !== 1 || bucket.key !== key || !Array.isArray(bucket.starts)) {
      return [];
    }
    const starts = bucket.starts.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    return pruneWindowTimestamps(starts, now, windowMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSharedStarts(
  filePath: string,
  key: string,
  starts: number[],
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    tmpPath,
    JSON.stringify(
      {
        version: 1,
        key,
        updatedAt: new Date().toISOString(),
        starts,
      },
      null,
      2,
    ),
  );
  await rename(tmpPath, filePath);
}

async function throttleSharedProviderRequestStart(
  options: ProviderThrottleOptions,
  requestsPerMinute: number,
  windowMs: number,
): Promise<boolean> {
  const sharedDisabled =
    process.env.LLM_WIKI_SHARED_RATE_LIMIT === '0' ||
    (process.env.VITEST_WORKER_ID !== undefined &&
      process.env.LLM_WIKI_SHARED_RATE_LIMIT !== '1');
  if (!options.workspaceRoot || sharedDisabled) {
    return false;
  }
  const dir = sharedRateLimitDir(options.workspaceRoot);
  const filePath = sharedRateLimitPath(options.workspaceRoot, options.key);
  const lockPath = `${filePath}.lock`;
  sharedRateLimitDirs.add(dir);
  await mkdir(dir, { recursive: true });

  while (true) {
    const release = await acquireLock(lockPath);
    let waitMs = 0;
    try {
      const now = Date.now();
      const starts = await readSharedStarts(filePath, options.key, now, windowMs);
      const oldest = starts[0];
      waitMs =
        starts.length < requestsPerMinute || oldest === undefined
          ? 0
          : Math.max(0, oldest + windowMs - now);
      if (waitMs === 0) {
        const startedAt = Date.now();
        starts.push(startedAt);
        await writeSharedStarts(filePath, options.key, starts);
        recordLocalStart(options.key, startedAt, windowMs);
        return true;
      }
    } finally {
      await release();
    }
    const retryAt = new Date(Date.now() + waitMs).toISOString();
    await options.logger?.info('provider:throttle', {
      label: options.label,
      requestsPerMinute,
      windowMs,
      waitMs,
      retryAt,
      shared: true,
    });
    options.logger?.recordProviderMetric?.({
      kind: providerKindFromLabel(options.label),
      throttleMs: waitMs,
    });
    await sleep(waitMs);
  }
}

async function throttleLocalProviderRequestStart(
  options: ProviderThrottleOptions,
  requestsPerMinute: number,
  windowMs: number,
): Promise<void> {
  const previous = rateLimiterQueues.get(options.key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const now = Date.now();
      const starts = pruneStarts(options.key, now, windowMs);
      const oldest = starts[0];
      const waitMs =
        starts.length < requestsPerMinute || oldest === undefined
          ? 0
          : Math.max(0, oldest + windowMs - now);
      if (waitMs > 0) {
        const retryAt = new Date(Date.now() + waitMs).toISOString();
        await options.logger?.info('provider:throttle', {
          label: options.label,
          requestsPerMinute,
          windowMs,
          waitMs,
          retryAt,
        });
        options.logger?.recordProviderMetric?.({
          kind: providerKindFromLabel(options.label),
          throttleMs: waitMs,
        });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      recordLocalStart(options.key, Date.now(), windowMs);
    });
  rateLimiterQueues.set(options.key, next);
  await next;
  if (rateLimiterQueues.get(options.key) === next) {
    rateLimiterQueues.delete(options.key);
  }
}

export async function throttleProviderRequestStart(
  options: ProviderThrottleOptions,
): Promise<void> {
  const requestsPerMinute = effectiveRequestsPerMinute(options.requestsPerMinute);
  const windowMs = requestWindowMs();
  try {
    if (await throttleSharedProviderRequestStart(options, requestsPerMinute, windowMs)) {
      return;
    }
  } catch (error) {
    await options.logger?.warn('provider:shared-rate-limit-fallback', {
      label: options.label,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  await throttleLocalProviderRequestStart(options, requestsPerMinute, windowMs);
}

export function providerRateLimitKey(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export function resetProviderRateLimiterForTests(): void {
  rateLimiterQueues.clear();
  rateLimiterStarts.clear();
  for (const dir of sharedRateLimitDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  sharedRateLimitDirs.clear();
}
