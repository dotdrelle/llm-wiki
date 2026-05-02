import { describe, expect, it } from 'vitest';
import {
  extractWikiLinks,
  normalizeSourceBody,
  parseTemplateInstructions,
} from '../src/utils/markdown.ts';

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

  it('normalizes Confluence-style HTML before ingestion', () => {
    const source = [
      'Actualites\t<ul><li>Comite de suivi du 13 avril<ul><li>``<a href="/spaces/JDLCDPPO/pages/674245662/Synthese">Synthese en cours</a></li>``',
      '<li><span style="color:var(--ds-text,#172b4d);">Point de RDV le <time class="date-upcoming" datetime="2026-05-07">07 May 2026</time> <span class="status-macro">DONE</span></li>',
      '</ul>',
    ].join('');

    const normalized = normalizeSourceBody(source);

    expect(normalized).toContain('- Comite de suivi du 13 avril');
    expect(normalized).toContain('[Synthese en cours](/spaces/JDLCDPPO/pages/674245662/Synthese)');
    expect(normalized).toContain('07 May 2026');
    expect(normalized).toContain('DONE');
    expect(normalized).not.toMatch(/<\/?(ul|li|span|time|a)\b/i);
    expect(normalized).not.toContain('``<');
  });
});
