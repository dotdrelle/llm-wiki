import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Git-backed integration suites spawn many short-lived processes. Running
    // one worker per CPU can starve them during a release build on a laptop.
    maxWorkers: 4,
  },
});
