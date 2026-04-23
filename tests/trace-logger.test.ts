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
    expect(content).toContain('trace:close');
  });
});
