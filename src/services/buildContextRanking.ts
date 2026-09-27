import type { WikiPage } from '../types.ts';
import { tokenizeSearchText } from '../utils/searchText.ts';

/**
 * Fast, workspace-local ranking used by the build preview path. Corpus IDF
 * replaces language-specific stopword lists, while title/path matches retain
 * their stronger signal.
 */
export function rankPagesForPlan(
  pages: WikiPage[],
  query: string,
  limit: number,
  maxContentChars = 8_000,
): Array<{ page: WikiPage; score: number }> {
  const queryWords = [...new Set(tokenizeSearchText(query))].slice(0, 24);
  if (queryWords.length === 0 || pages.length === 0) return [];

  const indexed = pages.map((page) => {
    const pathAndTitle = new Set(tokenizeSearchText(`${page.relativePath} ${page.name}`));
    const all = new Set([
      ...pathAndTitle,
      ...tokenizeSearchText(page.content.slice(0, maxContentChars)),
    ]);
    return { page, pathAndTitle, all };
  });
  const documentFrequency = new Map<string, number>();
  for (const document of indexed) {
    for (const token of document.all) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return indexed.map(({ page, pathAndTitle, all }) => {
    let score = 0;
    for (const word of queryWords) {
      const frequency = documentFrequency.get(word) ?? 0;
      const idf = Math.log1p((pages.length - frequency + 0.5) / (frequency + 0.5));
      if (pathAndTitle.has(word)) score += 3 * idf;
      if (all.has(word)) score += idf;
    }
    return { page, score };
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
