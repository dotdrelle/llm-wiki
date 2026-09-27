import { describe, expect, it } from 'vitest';
import type { WikiPage } from '../src/types.ts';
import { rankPagesForPlan } from '../src/services/buildContextRanking.ts';
import { tokenizeSearchText } from '../src/utils/searchText.ts';

function page(relativePath: string, content: string): WikiPage {
  return {
    absolutePath: `/${relativePath}`,
    relativePath,
    name: relativePath.split('/').at(-1) ?? '',
    type: 'concept',
    content,
  };
}

describe('language-neutral search text', () => {
  it('tokenizes Unicode letters, marks, and numbers without transliterating labels', () => {
    expect(tokenizeSearchText('résilience Москва 東京 92PREV33')).toEqual([
      'résilience', 'москва', '東京', '92prev33',
    ]);
  });

  it('uses workspace document frequency instead of language-specific stop words', () => {
    const common = page('wiki/concepts/common.md', 'avec dans request general context');
    const specific = page('wiki/concepts/specific.md', 'avec dans architectural request details');
    const ranked = rankPagesForPlan([common, specific], 'avec dans architectural request', 2);
    expect(ranked[0]?.page.relativePath).toBe('wiki/concepts/specific.md');
  });
});
