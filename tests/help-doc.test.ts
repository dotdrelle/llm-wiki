import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchHelpChapters } from '../src/utils/helpDoc.ts';

const helpDir = path.resolve(import.meta.dirname, '..', 'help-doc');

describe('product help documentation', () => {
  it('selects configuration documentation for concurrency questions', async () => {
    const result = await searchHelpChapters(
      'À quoi correspondent Parallelism & throughput et Collection concurrency ?',
      { dir: helpDir },
    );
    expect(result.chapters[0]?.id).toBe('09-configuration-performance');
    expect(result.chapters[0]?.content).toContain('scheduler workers');
  });

  it('contains no local project, test-workspace, credential, or secret values', async () => {
    const files = (await readdir(helpDir)).filter((name) => name.endsWith('.md'));
    const content = (await Promise.all(files.map(async (name) =>
      `${name}\n${await readFile(path.join(helpDir, name), 'utf8')}`))).join('\n');
    const forbidden = [
      /\bjuno\b/i,
      /\bmeteo\b/i,
      /llm-wiki-tmp/i,
      /\/(?:private\/)?tmp\//i,
      /\/Users\//i,
      /GOCSPX-/i,
      /\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/i,
      /(?:api[_ -]?key|token|secret)\s*[:=]\s*\S+/i,
    ];
    for (const pattern of forbidden) expect(content).not.toMatch(pattern);
  });
});
