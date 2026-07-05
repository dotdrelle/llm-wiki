import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { relativeFrom, resolveInside } from '../utils/path.ts';

type TraceLevel = 'info' | 'warn' | 'debug' | 'error';

export interface TraceLogger {
  readonly runId: string;
  readonly filePath: string;
  readonly displayPath: string;
  readonly debugEnabled: boolean;
  readonly verboseEnabled: boolean;
  recordProviderMetric?(metric: TraceProviderMetric): void;
  summary?(): TraceRunSummary;
  formatSummary?(): string;
  info(event: string, data?: Record<string, unknown>): Promise<void>;
  warn(event: string, data?: Record<string, unknown>): Promise<void>;
  debug(event: string, data?: Record<string, unknown>): Promise<void>;
  error(event: string, data?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export type TraceProviderKind = 'llm' | 'embedding' | 'rerank';

export interface TraceProviderMetric {
  kind: TraceProviderKind;
  calls?: number;
  cacheHits?: number;
  inputTokens?: number;
  outputTokens?: number;
  throttleMs?: number;
  latencyMs?: number;
}

export interface TraceProviderSummary {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  throttleMs: number;
  latencyMs: number;
}

export interface TraceRunSummary {
  wallMs: number;
  providerLatencyMs: number;
  providerLatencyRatio: number;
  llm: TraceProviderSummary;
  embedding: TraceProviderSummary;
  rerank: TraceProviderSummary;
}

interface CreateTraceLoggerOptions {
  rootDir: string;
  logsDir: string;
  command: string;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
  configFile?: string;
  provider?: string;
  model?: string;
  caller?: string;
}

function formatValue(value: unknown): string {
  if (value == null) {
    return 'null';
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const truncated =
      normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}...` : normalized;
    return /[\s=:"]/u.test(truncated) ? JSON.stringify(truncated) : truncated;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function formatData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) {
    return '';
  }

  return Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
}

function makeRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultTraceFilePath(
  logsDir: string,
  command: string,
  runId: string,
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(logsDir, `${command}-${stamp}-${runId}.log`);
}

class FileTraceLogger implements TraceLogger {
  readonly runId: string;
  readonly filePath: string;
  readonly displayPath: string;
  readonly debugEnabled: boolean;
  readonly verboseEnabled: boolean;

  private readonly startedAt = Date.now();
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly metrics: Record<TraceProviderKind, TraceProviderSummary> = {
    llm: emptyProviderSummary(),
    embedding: emptyProviderSummary(),
    rerank: emptyProviderSummary(),
  };

  constructor(args: {
    rootDir: string;
    filePath: string;
    verbose?: boolean;
    debug?: boolean;
    runId: string;
  }) {
    this.runId = args.runId;
    this.filePath = args.filePath;
    this.displayPath = relativeFrom(args.rootDir, args.filePath);
    this.verboseEnabled = Boolean(args.verbose || args.debug);
    this.debugEnabled = Boolean(args.debug);
  }

  async init(
    command: string,
    meta?: { configFile?: string; provider?: string; model?: string; caller?: string },
  ): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await this.info('trace:init', {
      command,
      runId: this.runId,
      traceFile: this.displayPath,
      ...(meta?.configFile ? { configFile: meta.configFile } : {}),
      ...(meta?.provider ? { provider: meta.provider } : {}),
      ...(meta?.model ? { model: meta.model } : {}),
      ...(meta?.caller ? { caller: meta.caller } : {}),
    });
  }

  async close(): Promise<void> {
    const summary = this.summary();
    await this.info('trace:summary', {
      wallMs: summary.wallMs,
      providerLatencyMs: summary.providerLatencyMs,
      providerLatencyRatio: summary.providerLatencyRatio,
      llmCalls: summary.llm.calls,
      llmInputTokens: summary.llm.inputTokens,
      llmOutputTokens: summary.llm.outputTokens,
      llmThrottleMs: summary.llm.throttleMs,
      llmLatencyMs: summary.llm.latencyMs,
      embeddingCalls: summary.embedding.calls,
      embeddingCacheHits: summary.embedding.cacheHits,
      embeddingThrottleMs: summary.embedding.throttleMs,
      embeddingLatencyMs: summary.embedding.latencyMs,
      rerankCalls: summary.rerank.calls,
      rerankCacheHits: summary.rerank.cacheHits,
      rerankThrottleMs: summary.rerank.throttleMs,
      rerankLatencyMs: summary.rerank.latencyMs,
    });
    await this.info('trace:close', {
      runId: this.runId,
      durationMs: summary.wallMs,
    });
    await this.pendingWrite;
  }

  recordProviderMetric(metric: TraceProviderMetric): void {
    const current = this.metrics[metric.kind];
    current.calls += metric.calls ?? 0;
    current.cacheHits += metric.cacheHits ?? 0;
    current.inputTokens += metric.inputTokens ?? 0;
    current.outputTokens += metric.outputTokens ?? 0;
    current.throttleMs += metric.throttleMs ?? 0;
    current.latencyMs += metric.latencyMs ?? 0;
  }

  summary(): TraceRunSummary {
    const wallMs = Date.now() - this.startedAt;
    const providerLatencyMs =
      this.metrics.llm.latencyMs +
      this.metrics.embedding.latencyMs +
      this.metrics.rerank.latencyMs;
    return {
      wallMs,
      providerLatencyMs,
      providerLatencyRatio: wallMs > 0 ? Math.min(1, providerLatencyMs / wallMs) : 0,
      llm: { ...this.metrics.llm },
      embedding: { ...this.metrics.embedding },
      rerank: { ...this.metrics.rerank },
    };
  }

  formatSummary(): string {
    return formatTraceRunSummary(this.summary());
  }

  async info(event: string, data?: Record<string, unknown>): Promise<void> {
    await this.log('info', event, data);
  }

  async warn(event: string, data?: Record<string, unknown>): Promise<void> {
    await this.log('warn', event, data);
  }

  async debug(event: string, data?: Record<string, unknown>): Promise<void> {
    await this.log('debug', event, data);
  }

  async error(event: string, data?: Record<string, unknown>): Promise<void> {
    await this.log('error', event, data);
  }

  private async log(
    level: TraceLevel,
    event: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const elapsedMs = Date.now() - this.startedAt;
    const suffix = formatData(data);
    const fileLine = `${now.toISOString()} +${elapsedMs}ms ${level.toUpperCase()} ${event}${
      suffix ? ` ${suffix}` : ''
    }\n`;

    if (
      level === 'error' ||
      level === 'warn' ||
      (level === 'info' && this.verboseEnabled) ||
      (level === 'debug' && this.debugEnabled)
    ) {
      const levelColors: Record<TraceLevel, string> = {
        info: '\x1b[36mINFO \x1b[0m',
        warn: '\x1b[33mWARN \x1b[0m',
        error: '\x1b[31mERROR\x1b[0m',
        debug: '\x1b[90mDEBUG\x1b[0m',
      };
      const timeLabel = now.toISOString().slice(11, 19);
      const consoleLine = `\n${levelColors[level]} [${timeLabel} +${elapsedMs}ms] ${event}${
        suffix ? ` ${suffix}` : ''
      }`;
      if (level === 'error') {
        console.error(consoleLine);
      } else if (level === 'warn') {
        console.warn(consoleLine);
      } else {
        console.log(consoleLine);
      }
    }

    this.pendingWrite = this.pendingWrite.then(() =>
      appendFile(this.filePath, fileLine, 'utf8'),
    );
    await this.pendingWrite;
  }
}

function emptyProviderSummary(): TraceProviderSummary {
  return {
    calls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    throttleMs: 0,
    latencyMs: 0,
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatTraceRunSummary(summary: TraceRunSummary): string {
  return [
    `LLM: ${summary.llm.calls} appel(s) · ${formatTokenCount(summary.llm.inputTokens)} tokens in · ${formatTokenCount(summary.llm.outputTokens)} tokens out · throttle ${formatDuration(summary.llm.throttleMs)} · latence ${formatDuration(summary.llm.latencyMs)}`,
    `Embeddings: ${summary.embedding.calls} appel(s) (${summary.embedding.cacheHits} cache hit(s)) · Rerank: ${summary.rerank.calls} appel(s) (${summary.rerank.cacheHits} cache hit(s))`,
    `Temps mur: ${formatDuration(summary.wallMs)} (dont ${formatPercent(summary.providerLatencyRatio)} latence provider)`,
  ].join('\n');
}

export function printTraceSummary(logger: TraceLogger): void {
  const formatted = logger.formatSummary?.();
  if (formatted) console.log(`\n${formatted}`);
}

export async function createTraceLogger(
  options: CreateTraceLoggerOptions,
): Promise<TraceLogger> {
  const runId = makeRunId();
  const filePath = options.traceFile
    ? resolveInside(options.rootDir, options.traceFile)
    : makeDefaultTraceFilePath(options.logsDir, options.command, runId);
  const logger = new FileTraceLogger({
    rootDir: options.rootDir,
    filePath,
    verbose: options.verbose,
    debug: options.debug,
    runId,
  });

  await logger.init(options.command, {
    configFile: options.configFile,
    provider: options.provider,
    model: options.model,
    caller: options.caller,
  });
  return logger;
}
