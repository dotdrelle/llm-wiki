import { describe, expect, it } from 'vitest';
import { recentIngestChanges } from '../src/serve/html/sidebarFreshness.ts';
import { WIKI_LAYOUT_SCRIPT } from '../src/serve/html/wikiLayoutScript.ts';

// "New since the last ingest" is a session's news: after a serve restart a
// 158-page ingest had to be cleared one click at a time.
describe('unread marks of the last ingest', () => {
  const mtimes = new Map([['wiki/a.md', 1_000], ['wiki/b.md', 3_000]]);

  it('keeps only pages written since this serve started', () => {
    expect([...recentIngestChanges(mtimes, 500).keys()]).toEqual(['wiki/a.md', 'wiki/b.md']);
    expect([...recentIngestChanges(mtimes, 500, 2_000).keys()]).toEqual(['wiki/b.md']);
    expect(recentIngestChanges(mtimes, 500, 4_000).size).toBe(0);
    expect(recentIngestChanges(mtimes, null, 0).size).toBe(0);
  });

  it('lets the wiki badge mark every page as read without switching the view', () => {
    expect(WIKI_LAYOUT_SCRIPT).toContain("closest?.('[data-mark-all-read]')");
    expect(WIKI_LAYOUT_SCRIPT).toMatch(/data-mark-all-read[\s\S]*?event\.stopPropagation\(\)[\s\S]*?applyUnreadBadges\(\);\n {2}\}, true\);/);
  });
});
