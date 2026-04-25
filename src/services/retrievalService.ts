import { canonicalizeName } from '../utils/path.ts';
import { splitByHeadings } from '../utils/markdown.ts';
import type { AppConfig, SearchResult, WikiPage } from '../types.ts';
import type { MarkdownChunk } from '../utils/markdown.ts';
import type { WorkspaceService } from './workspaceService.ts';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'dans',
  'avec',
  'pour',
  'that',
  'into',
  'have',
  'will',
  'sur',
  'une',
  'des',
  'les',
  'est',
  'are',
  'you',
  'your',
  'not',
  'pas',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (token) => !STOP_WORDS.has(token),
  );
}

function scoreChunk(queryTokens: string[], chunk: MarkdownChunk, page: WikiPage): number {
  const contentSet = new Set(tokenize(chunk.content));
  const headingTokens = tokenize(chunk.heading);
  const nameTokens = tokenize(page.name);
  const pathTokens = tokenize(page.relativePath);
  let score = 0;

  for (const token of queryTokens) {
    if (contentSet.has(token)) score += 1;
    if (headingTokens.includes(token)) score += 3;
    if (nameTokens.includes(token)) score += 4;
    if (pathTokens.includes(token)) score += 2;
    if (canonicalizeName(page.name).includes(canonicalizeName(token))) score += 1;
  }

  return score;
}

export class RetrievalService {
  private readonly workspace: WorkspaceService;
  private readonly config: AppConfig;

  constructor(workspace: WorkspaceService, config: AppConfig) {
    this.workspace = workspace;
    this.config = config;
  }

  async search(
    query: string,
    options?: { limit?: number; includeRaw?: boolean },
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.config.retrieval.maxContextFiles;
    const queryTokens = tokenize(query);
    const wikiPages = await this.workspace.listWikiPages();
    const rawPages = options?.includeRaw ? await this.workspace.listIngestedSourcePages() : [];

    const results: SearchResult[] = [];

    for (const page of [...wikiPages, ...rawPages]) {
      const chunks = splitByHeadings(page.content);

      for (const chunk of chunks) {
        const score = scoreChunk(queryTokens, chunk, page);
        if (score > 0) {
          const isWholePageChunk = chunks.length === 1 && !chunk.heading;
          results.push({
            page,
            score,
            chunk: isWholePageChunk
              ? undefined
              : { headingPath: chunk.headingPath, content: chunk.content },
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
