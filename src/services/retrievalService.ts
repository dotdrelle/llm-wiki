import { canonicalizeName } from '../utils/path.ts';
import type { AppConfig, SearchResult, WikiPage } from '../types.ts';
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

function scorePage(queryTokens: string[], page: WikiPage): number {
  const contentTokens = tokenize(page.content);
  const contentSet = new Set(contentTokens);
  const nameTokens = tokenize(page.name);
  const pathTokens = tokenize(page.relativePath);
  let score = 0;

  for (const token of queryTokens) {
    if (contentSet.has(token)) {
      score += 1;
    }
    if (nameTokens.includes(token)) {
      score += 4;
    }
    if (pathTokens.includes(token)) {
      score += 2;
    }
    if (canonicalizeName(page.name).includes(canonicalizeName(token))) {
      score += 1;
    }
  }

  return score;
}

export class RetrievalService {
  private readonly workspace: WorkspaceService;
  private readonly config: AppConfig;

  constructor(
    workspace: WorkspaceService,
    config: AppConfig,
  ) {
    this.workspace = workspace;
    this.config = config;
  }

  async search(query: string, options?: { limit?: number; includeRaw?: boolean }): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.config.retrieval.maxContextFiles;
    const queryTokens = tokenize(query);
    const wikiPages = await this.workspace.listWikiPages();
    const rawPages = options?.includeRaw ? await this.workspace.listIngestedSourcePages() : [];

    return [...wikiPages, ...rawPages]
      .map((page) => ({
        page,
        score: scorePage(queryTokens, page),
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
