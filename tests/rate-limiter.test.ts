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
      const entry = Date.now();
      await throttleProviderRequestStart({
        key: 'https://provider.example.test/v1',
        requestsPerMinute: 1,
        workspaceRoot: process.argv[1],
      });
      const exit = Date.now();
      console.log(entry, exit);
    `;
    // A generous window makes "the second process waited for the first" hold
    // even when the two spawned node processes take a while to boot. 1 request
    // per window: the first process to reach the limiter enters immediately,
    // the second observes the first's slot and waits for the window to elapse.
    const env = {
      ...process.env,
      // Disable ANSI colouring in the spawned children: their console.log of
      // the numeric timestamps came back wrapped in \x1b[33m…\x1b[39m on this
      // environment, which made Number() yield NaN however close the values
      // were. Colour is presentation, never something this test should parse.
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      LLM_WIKI_SHARED_RATE_LIMIT: '1',
      LLM_WIKI_RATE_LIMIT_WINDOW_MS: '500',
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

    // Each child prints "entry exit" (ms timestamps). Measure the throttling
    // *wait* squarely inside each process (exit - entry) rather than comparing
    // two cross-process Date.now() values: 1 ms resolution and a near-simultaneous
    // spawn could otherwise make that difference 0 (or NaN on a stray character)
    // even though the sharing worked. Sharing is proven by the wait asymmetry:
    // exactly one process enters without waiting, the other waits >= ~window.
    const waits = children
      .map(({ stdout }) => {
        // Belt and braces: strip any colour escape codes children might emit
        // even with FORCE_COLOR/NO_COLOR set, so numeric parsing can never
        // turn into NaN on presentation noise.
        const clean = String(stdout).replace(/\x1b\[[0-9;]*m/g, '').trim();
        const parts = clean.split(/\s+/).map(Number);
        return parts[1] - parts[0];
      })
      .sort((a, b) => a - b);

    expect(waits).toHaveLength(2);
    for (const wait of waits) {
      expect(Number.isFinite(wait)).toBe(true);
    }
    // The process that entered first: no waiting.
    expect(waits[0]).toBeLessThan(100);
    // The process that saw the first's slot: it had to wait out the window.
    expect(waits[1]).toBeGreaterThanOrEqual(100);
  });
});

