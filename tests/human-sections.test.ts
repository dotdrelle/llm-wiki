import { describe, expect, it } from 'vitest';
import { preserveHumanSections, producedSectionKeys } from '../src/maintenance/humanSections.ts';

const built = '# Note\n\n## Summary\n\nold summary\n\n## Key Facts\n\nold facts\n\n## Old Template Part\n\ngone soon\n';
const produced = producedSectionKeys(built);

describe('hand-added sections survive a rebuild', () => {
  it('keeps a section the template never produced, where the human put it', () => {
    const edited = built.replace('## Key Facts', '## My Own Notes\n\nwritten by hand\n\n## Key Facts');
    const rendered = '# Note\n\n## Summary\n\nnew summary\n\n## Key Facts\n\nnew facts\n';
    const result = preserveHumanSections(edited, rendered, produced);
    expect(result.preserved).toEqual(['Note > My Own Notes']);
    expect(result.markdown).toContain('written by hand');
    expect(result.markdown).toContain('new summary');
    expect(result.markdown.indexOf('My Own Notes')).toBeGreaterThan(result.markdown.indexOf('new summary'));
    expect(result.markdown.indexOf('My Own Notes')).toBeLessThan(result.markdown.indexOf('new facts'));
  });

  it('drops a section the template produced before and no longer produces', () => {
    const rendered = '# Note\n\n## Summary\n\nnew summary\n\n## Key Facts\n\nnew facts\n';
    const result = preserveHumanSections(built, rendered, produced);
    expect(result.preserved).toEqual([]);
    expect(result.markdown).not.toContain('gone soon');
  });

  it('keeps a hand sub-section under its template parent', () => {
    const edited = built.replace('old facts', 'old facts\n\n### Verified on site\n\nchecked by me');
    const rendered = '# Note\n\n## Summary\n\nnew\n\n## Key Facts\n\nnew facts\n\n## Open Questions\n\nq\n';
    const result = preserveHumanSections(edited, rendered, produced);
    expect(result.preserved).toEqual(['Note > Key Facts > Verified on site']);
    const md = result.markdown;
    expect(md.indexOf('Verified on site')).toBeGreaterThan(md.indexOf('new facts'));
    expect(md.indexOf('Verified on site')).toBeLessThan(md.indexOf('Open Questions'));
  });

  it('keeps nothing when the last build did not record its sections', () => {
    const edited = built + '\n## Mine\n\nhand\n';
    const rendered = '# Note\n\n## Summary\n\nnew\n';
    expect(preserveHumanSections(edited, rendered, undefined)).toEqual({ markdown: rendered, preserved: [] });
  });
});
