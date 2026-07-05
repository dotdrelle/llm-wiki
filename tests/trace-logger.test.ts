import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTraceLogger } from '../src/services/traceLogger.ts';

describe('trace logger', () => {
  it('writes a run log file under .wiki/logs by default', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-trace-'));
    const logger = await createTraceLogger({
      rootDir: root,
      logsDir: path.join(root, '.wiki', 'logs'),
      command: 'ingest',
    });

    await logger.info('ingest:test', {
      source: 'raw/untracked/test.md',
      operations: 2,
    });
    await logger.close();

    expect(logger.displayPath.startsWith('.wiki/logs/ingest-')).toBe(true);
    const content = await readFile(logger.filePath, 'utf8');
    expect(content).toContain('trace:init');
    expect(content).toContain('ingest:test');
    expect(content).toContain('trace:summary');
    expect(content).toContain('trace:close');
  });

  it('aggregates provider metrics into a run summary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-trace-summary-'));
    const logger = await createTraceLogger({
      rootDir: root,
      logsDir: path.join(root, '.wiki', 'logs'),
      command: 'build',
    });

    logger.recordProviderMetric?.({
      kind: 'llm',
      calls: 2,
      inputTokens: 1200,
      outputTokens: 300,
      throttleMs: 1000,
      latencyMs: 2000,
    });
    logger.recordProviderMetric?.({
      kind: 'embedding',
      calls: 1,
      cacheHits: 3,
      latencyMs: 500,
    });

    const summary = logger.summary?.();
    expect(summary?.llm.calls).toBe(2);
    expect(summary?.llm.inputTokens).toBe(1200);
    expect(summary?.embedding.cacheHits).toBe(3);
    expect(logger.formatSummary?.()).toContain('LLM: 2 appel(s)');

    await logger.close();
    const content = await readFile(logger.filePath, 'utf8');
    expect(content).toContain('trace:summary');
    expect(content).toContain('llmCalls=2');
    expect(content).toContain('embeddingCacheHits=3');
  });
});
