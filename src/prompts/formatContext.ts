import type { SearchResult } from '../types.ts';

export function formatContextResult(result: SearchResult, maxChunkChars: number): string {
  const raw = result.chunk?.content ?? result.page.content;
  const content =
    raw.length > maxChunkChars ? `${raw.slice(0, maxChunkChars)}\n...[truncated]` : raw;

  const label =
    result.chunk && result.chunk.headingPath.length > 0
      ? `${result.page.relativePath} — ${result.chunk.headingPath.join(' > ')}`
      : result.page.relativePath;

  return `### ${label}\nScore: ${result.score}\n${content}`;
}
