import { describe, expect, it } from 'vitest';
import { summarizeCommit, summarizeNames } from '../src/utils/summary.ts';

describe('summarizeNames', () => {
  it('lists every name up to the cap, without a suffix', () => {
    expect(summarizeNames(['alpha', 'beta', 'gamma'])).toBe('alpha, beta, gamma');
  });

  it('appends a +N more suffix beyond the cap', () => {
    expect(summarizeNames(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e +2 more');
  });

  it('returns an empty string for an empty list', () => {
    expect(summarizeNames([])).toBe('');
  });
});

describe('summarizeCommit', () => {
  it('formats the full message that lands in the workspace history', () => {
    expect(summarizeCommit('build', 'deliverable', ['a', 'b', 'c']))
      .toBe('build: 3 deliverable(s) — a, b, c');
    expect(summarizeCommit('ingest', 'source', ['a', 'b', 'c', 'd', 'e', 'f', 'g']))
      .toBe('ingest: 7 source(s) — a, b, c, d, e +2 more');
  });

  it('omits the separator when nothing changed', () => {
    expect(summarizeCommit('build', 'deliverable', [])).toBe('build: 0 deliverable(s)');
  });
});
