import type { TraceLogger } from './traceLogger.ts';

const rateLimiterQueues = new Map<string, Promise<void>>();
const rateLimiterStarts = new Map<string, number[]>();

function requestWindowMs(): number {
  const override = Number(process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(override) && override > 0 ? override : 60_000;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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

function pruneStarts(key: string, now: number, windowMs: number): number[] {
  const threshold = now - windowMs;
  const starts = (rateLimiterStarts.get(key) ?? []).filter((startedAt) => startedAt > threshold);
  rateLimiterStarts.set(key, starts);
  return starts;
}

function localWindowRemainingMs(key: string): number | undefined {
  const windowMs = requestWindowMs();
  const now = Date.now();
  const starts = pruneStarts(key, now, windowMs);
  const oldest = starts[0];
  if (oldest === undefined) return undefined;
  const remainingMs = oldest + windowMs - now;
  if (remainingMs <= 0) return undefined;
  return remainingMs + readPositiveIntegerEnv('LLM_WIKI_RATE_LIMIT_RETRY_SAFETY_MS', 1_000);
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
  return localWindowRemainingMs(options.key) ?? readPositiveIntegerEnv('LLM_WIKI_RATE_LIMIT_RETRY_MS', 65_000);
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
  await new Promise((resolve) => setTimeout(resolve, options.waitMs));
}

export async function throttleProviderRequestStart(options: {
  key: string;
  requestsPerMinute: number;
  logger?: TraceLogger;
  label?: string;
}): Promise<void> {
  const requestsPerMinute = Math.max(1, Math.floor(options.requestsPerMinute));
  const windowMs = requestWindowMs();
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
        await options.logger?.info('provider:throttle', {
          label: options.label,
          requestsPerMinute,
          windowMs,
          waitMs,
        });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      pruneStarts(options.key, Date.now(), windowMs).push(Date.now());
    });
  rateLimiterQueues.set(options.key, next);
  await next;
  if (rateLimiterQueues.get(options.key) === next) {
    rateLimiterQueues.delete(options.key);
  }
}

export function providerRateLimitKey(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export function resetProviderRateLimiterForTests(): void {
  rateLimiterQueues.clear();
  rateLimiterStarts.clear();
}
