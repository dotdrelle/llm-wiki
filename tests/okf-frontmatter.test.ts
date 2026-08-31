import { describe, expect, it } from 'vitest';
import {
  applyOkfFrontmatter,
  isOkfType,
  okfTypeForPath,
  OKF_TYPE_CONCEPT,
  OKF_TYPE_DELIVERABLE,
  OKF_TYPE_SOURCE,
} from '../src/okf/frontmatter.ts';

describe('okfTypeForPath', () => {
  it('derives the generic concept type for every concept path', () => {
    expect(okfTypeForPath('wiki/concepts/market-offering/zephyr.md')).toBe('concept');
    expect(okfTypeForPath('wiki/concepts/unclassified/foo.md')).toBe('concept');
  });

  it('assigns the fixed types of the non-concept bundle paths', () => {
    expect(okfTypeForPath('wiki/sources/note.md')).toBe('source');
    expect(okfTypeForPath('wiki/answers/foo.md')).toBe('answer');
    expect(okfTypeForPath('wiki/index.md')).toBe('index');
    expect(okfTypeForPath('wiki/log.md')).toBe('log');
    expect(okfTypeForPath('wiki/concepts-grid.md')).toBe('concept-grid');
    expect(okfTypeForPath('deliverables/rapport.md')).toBe('deliverable');
  });

  it('returns null for paths outside the bundle', () => {
    expect(okfTypeForPath('raw/untracked/x.md')).toBeNull();
    expect(okfTypeForPath('raw/ingested/x.md')).toBeNull();
    expect(okfTypeForPath('templates/x.md')).toBeNull();
    expect(okfTypeForPath('build-context/x.md')).toBeNull();
    expect(okfTypeForPath('.wiki/skills/x.md')).toBeNull();
  });
});

describe('applyOkfFrontmatter', () => {
  it('adds type to a page that has no frontmatter', () => {
    const out = applyOkfFrontmatter('# Title\n\nBody.\n', { type: OKF_TYPE_CONCEPT });
    expect(out).toContain('type: concept');
    expect(out).toContain('# Title');
    expect(out).toContain('Body.');
  });

  it('adds type alongside existing frontmatter without touching it', () => {
    const out = applyOkfFrontmatter('---\nsubject: zephyr\n---\n# Zephyr\n', { type: OKF_TYPE_CONCEPT });
    expect(out).toContain('subject: zephyr');
    expect(out).toContain('type: concept');
  });

  it('never overwrites a manual type', () => {
    const out = applyOkfFrontmatter('---\ntype: regulation\n---\nbody\n', { type: OKF_TYPE_CONCEPT });
    expect(out).toContain('type: regulation');
    expect(out).not.toContain('type: concept');
  });

  it('returns the content unchanged when nothing is added', () => {
    const content = '---\ntype: concept\n---\nbody\n';
    expect(applyOkfFrontmatter(content, { type: OKF_TYPE_CONCEPT })).toBe(content);
  });

  it('adds reserved title and timestamp keys only when absent', () => {
    const out = applyOkfFrontmatter('# X\n', { type: OKF_TYPE_DELIVERABLE, title: 'Rapport', timestamp: '2026-08-26' });
    expect(out).toContain('type: deliverable');
    expect(out).toContain('title: Rapport');
    // gray-matter/js-yaml normalizes a date-like scalar into a Date and
    // re-serializes it; assert the key is present, not the exact spelling.
    expect(out).toContain('timestamp:');
  });
});

describe('isOkfType', () => {
  it('recognizes only the closed vocabulary', () => {
    expect(isOkfType('concept')).toBe(true);
    expect(isOkfType(OKF_TYPE_SOURCE)).toBe(true);
    expect(isOkfType('deliverable')).toBe(true);
    expect(isOkfType('random')).toBe(false);
    expect(isOkfType(undefined)).toBe(false);
    expect(isOkfType(42)).toBe(false);
  });
});
