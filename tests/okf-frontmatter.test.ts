import { describe, expect, it } from 'vitest';
import {
  applyOkfFrontmatter,
  carryForwardEngineFrontmatter,
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

describe('carryForwardEngineFrontmatter', () => {
  const existing = [
    '---',
    'type: concept',
    'subject: souverainete',
    'generated:',
    '  by: llm-wiki',
    "  at: '2026-01-01T00:00:00.000Z'",
    'status: stable',
    'verified:',
    '  - by: human:merge',
    "    at: '2026-01-02T00:00:00.000Z'",
    'sources:',
    '  - path: raw/ingested/source-one.md',
    '    usage_count: 1',
    '---',
    '',
    '# Souverainete',
    '',
    'Ancien contenu. [src: raw/ingested/source-one.md]',
    '',
  ].join('\n');

  const next = [
    '---',
    'type: concept',
    'subject: souverainete',
    'generated:',
    '  by: llm-wiki',
    "  at: '2026-06-01T00:00:00.000Z'",
    'status: draft',
    'sources:',
    '  - path: raw/ingested/source-two.md',
    '    usage_count: 4',
    '---',
    '',
    '# Souverainete',
    '',
    'Nouveau contenu. [src: raw/ingested/source-two.md]',
    '',
  ].join('\n');

  it('accumulates sources across an update instead of resetting them', () => {
    const out = carryForwardEngineFrontmatter(existing, next);
    expect(out).toContain('path: raw/ingested/source-one.md');
    expect(out).toContain('path: raw/ingested/source-two.md');
    expect(out).toContain('usage_count: 4');
    // The body is the update's, never the old one.
    expect(out).toContain('Nouveau contenu.');
    expect(out).not.toContain('Ancien contenu.');
  });

  it('keeps the first generated stamp and a human status/verified decision', () => {
    const out = carryForwardEngineFrontmatter(existing, next);
    expect(out).toContain("at: '2026-01-01T00:00:00.000Z'");
    expect(out).not.toContain("at: '2026-06-01T00:00:00.000Z'");
    expect(out).toContain('status: stable');
    expect(out).not.toContain('status: draft');
    expect(out).toContain('human:merge');
  });

  it('lets the update win on content keys', () => {
    const a = '---\ntype: concept\nsubject: old-subject\ntags: [old]\n---\n\n# X\n';
    const b = '---\ntype: concept\nsubject: new-subject\ntags: [new]\n---\n\n# X\n';
    const out = carryForwardEngineFrontmatter(a, b);
    expect(out).toContain('subject: new-subject');
    expect(out).toContain('new');
    expect(out).not.toContain('old-subject');
  });

  it('returns the next content unchanged when there is nothing carried', () => {
    const out = carryForwardEngineFrontmatter('not frontmatter at all', '# X\n');
    expect(out).toBe('# X\n');
  });
});
