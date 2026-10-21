import { describe, expect, it } from 'vitest';
import {
  materializeLineAnchor,
  normalizeHeadingText,
  resolveAnchor,
  serializeHeadingPath,
} from '../src/provenance/locators.ts';
import { splitMarkdownSections } from '../src/utils/markdown.ts';

/*
 Property-style coverage for the one resolver every reading path now shares.

 The corpus is generated deterministically: heading trees with depth jumps,
 duplicate titles, frontmatter, fenced pseudo-headings, accents, `>`/`#`/`%`
 in titles, and CRLF variants. The invariants — not the examples — are what the
 manager and the engine rely on.
*/

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = ['Top', 'Sub', 'Détail', 'A > B', '100%', '#tag', 'Coûts', 'Annexe', 'Résumé'];

function generateMarkdown(rnd: () => number, caseIndex: number): string {
  const lines: string[] = [];
  if (rnd() < 0.4) {
    lines.push('---', '# fake frontmatter heading', `title: Case ${caseIndex}`, '---', '');
  }
  let level = 1;
  let headingCount = 0;
  const maxHeadings = 4 + Math.floor(rnd() * 8);
  while (headingCount < maxHeadings) {
    const jump = rnd();
    level = jump < 0.2 ? Math.max(1, level - 1) : jump < 0.55 ? level : Math.min(6, level + 1);
    const title = TITLES[Math.floor(rnd() * TITLES.length)];
    lines.push(`${'#'.repeat(level)} ${title}`, '', `content-${caseIndex}-${headingCount}`, '');
    headingCount += 1;
    if (rnd() < 0.25) {
      lines.push('```', '# fenced pseudo-heading', '```', '');
    }
  }
  const markdown = lines.join('\n');
  return rnd() < 0.3 ? markdown.replace(/\n/g, '\r\n') : markdown;
}

function keyOfHeadingPath(parts: string[]): string {
  return parts.map(normalizeHeadingText).join('\u0000');
}

describe('resolveAnchor properties', () => {
  it('round-trips every unique section path and heading text', () => {
    const rnd = mulberry32(20261021);
    for (let caseIndex = 0; caseIndex < 80; caseIndex += 1) {
      const markdown = generateMarkdown(rnd, caseIndex);
      const sections = splitMarkdownSections(markdown).sections;
      const pathCounts = new Map<string, number>();
      const textCounts = new Map<string, number>();
      for (const section of sections) {
        const pathKey = keyOfHeadingPath(section.headingPath);
        pathCounts.set(pathKey, (pathCounts.get(pathKey) ?? 0) + 1);
        const textKey = normalizeHeadingText(section.headingText);
        textCounts.set(textKey, (textCounts.get(textKey) ?? 0) + 1);
      }
      for (const section of sections) {
        const pathKey = keyOfHeadingPath(section.headingPath);
        const pathResolution = resolveAnchor(markdown, serializeHeadingPath(section.headingPath));
        const singleComponent = section.headingPath.length === 1;
        const unique = singleComponent
          ? textCounts.get(normalizeHeadingText(section.headingText)) === 1
          : pathCounts.get(pathKey) === 1;
        if (unique) {
          expect(pathResolution.status, `case ${caseIndex}: ${section.headingPath.join(' > ')}`).toBe('resolved');
          if (pathResolution.status === 'resolved') {
            expect(pathResolution.text).toBe(section.markdown);
          }
        } else {
          expect(pathResolution.status).toBe('ambiguous');
        }

        const textKey = normalizeHeadingText(section.headingText);
        const textResolution = resolveAnchor(markdown, serializeHeadingPath([section.headingText]));
        if (textCounts.get(textKey) === 1) {
          expect(textResolution.status, `case ${caseIndex}: #${section.headingText}`).toBe('resolved');
        } else {
          expect(textResolution.status).toBe('ambiguous');
        }
      }
    }
  });

  it('verifies an exact line anchor and reports a changed line as missing', () => {
    const rnd = mulberry32(42);
    for (let caseIndex = 0; caseIndex < 30; caseIndex += 1) {
      const markdown = generateMarkdown(rnd, caseIndex);
      const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
      const contentLine = lines.findIndex((line) => /^content-/.test(line));
      expect(contentLine).toBeGreaterThanOrEqual(0);
      const anchor = materializeLineAnchor(markdown, contentLine + 1, contentLine + 1);
      expect(anchor, `case ${caseIndex}`).toBeTruthy();
      const resolved = resolveAnchor(markdown, anchor!);
      expect(resolved.status).toBe('resolved');
      if (resolved.status === 'resolved') {
        expect(resolved.text).toBe(lines[contentLine]);
      }
      const changedLines = [...lines];
      changedLines[contentLine] = `${changedLines[contentLine]} changed`;
      expect(resolveAnchor(changedLines.join('\n'), anchor!).status).toBe('missing');
    }
  });
});
