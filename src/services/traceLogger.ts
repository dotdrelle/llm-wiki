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
  info(event: string, data?: Record<string, unknown>): Promise<void>;
  warn(event: string, data?: Record<string, unknown>): Promise<void>;
  debug(event: string, data?: Record<string, unknown>): Promise<void>;
  error(event: string, data?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

interface CreateTraceLoggerOptions {
  rootDir: string;
  logsDir: string;
  command: string;
  verbose?: boolean;
  debug?: boolean;
  traceFile?: string;
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

function makeDefaultTraceFilePath(logsDir: string, command: string, runId: string): string {
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

  async init(command: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await this.info('trace:init', {
      command,
      runId: this.runId,
      traceFile: this.displayPath,
    });
  }

  async close(): Promise<void> {
    await this.info('trace:close', {
      runId: this.runId,
      durationMs: Date.now() - this.startedAt,
    });
    await this.pendingWrite;
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
      const timeLabel = now.toISOString().slice(11, 19);
      const consoleLine = `[${timeLabel} +${elapsedMs}ms] ${event}${
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

    this.pendingWrite = this.pendingWrite.then(() => appendFile(this.filePath, fileLine, 'utf8'));
    await this.pendingWrite;
  }
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

  await logger.init(options.command);
  return logger;
}
