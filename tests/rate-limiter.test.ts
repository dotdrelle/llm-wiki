import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resetProviderRateLimiterForTests } from '../src/services/rateLimiter.ts';

const execFileAsync = promisify(execFile);

describe('provider rate limiter', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    resetProviderRateLimiterForTests();
    delete process.env.LLM_WIKI_RATE_LIMIT_WINDOW_MS;
    delete process.env.WIKI_RPM_SHARE;
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('shares provider request starts across processes for one workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rate-limit-'));
    tempRoots.push(root);
    const rateLimiterUrl = pathToFileURL(
      path.resolve('src/services/rateLimiter.ts'),
    ).href;
    const script = `
      const { throttleProviderRequestStart } = await import(process.argv[2]);
      await throttleProviderRequestStart({
        key: 'https://provider.example.test/v1',
        requestsPerMinute: 1,
        workspaceRoot: process.argv[1],
      });
      console.log(Date.now());
    `;
    const env = {
      ...process.env,
      LLM_WIKI_SHARED_RATE_LIMIT: '1',
      LLM_WIKI_RATE_LIMIT_WINDOW_MS: '120',
    };

    const children = await Promise.all([
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '-e',
        script,
        root,
        rateLimiterUrl,
      ], { env }),
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '-e',
        script,
        root,
        rateLimiterUrl,
      ], { env }),
    ]);
    const starts = children
      .map(({ stdout }) => Number(String(stdout).trim()))
      .sort((a, b) => a - b);

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(100);
  });
});
