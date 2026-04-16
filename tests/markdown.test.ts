import { describe, expect, it } from 'vitest';
import { extractWikiLinks, parseTemplateInstructions } from '../src/utils/markdown.ts';

describe('markdown helpers', () => {
  it('parses instruction placeholders with heading context', () => {
    const content = [
      '# Brief',
      '',
      '## Summary',
      '[[INSTRUCTION: Summarize the documented facts.]]',
      '',
      '## Risks',
      '[[INSTRUCTION: List the gaps.]]',
    ].join('\n');

    const instructions = parseTemplateInstructions(content);
    expect(instructions).toHaveLength(2);
    expect(instructions[0].headingPath).toEqual(['Brief', 'Summary']);
    expect(instructions[1].headingPath).toEqual(['Brief', 'Risks']);
  });

  it('extracts wiki links with aliases', () => {
    const links = extractWikiLinks('See [[Claude Code|CC]] and [[Local-first]].');
    expect(links).toEqual(['Claude Code', 'Local-first']);
  });
});
