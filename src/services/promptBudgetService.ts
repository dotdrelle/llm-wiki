import type { AppConfig, BuildBatchPlan } from '../types.ts';

const CHARS_PER_TOKEN = 4;

export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function inputTokenLimitToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

export class PromptBudgetService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  estimateTokens(system: string, user: string): number {
    return estimateInputTokens(`${system}\n${user}`);
  }

  targetInputChars(): number {
    return inputTokenLimitToChars(this.config.limits.targetInputTokensPerCall);
  }

  maxInputChars(): number {
    return inputTokenLimitToChars(this.config.limits.maxInputTokensPerCall);
  }

  describeBatch(index: number, slotIds: string[], contextPages: string[], chars: number): BuildBatchPlan {
    const estimatedInputTokens = estimateInputTokens('x'.repeat(chars));
    return {
      index,
      slotIds,
      contextPages,
      estimatedInputTokens,
      exceedsTarget: estimatedInputTokens > this.config.limits.targetInputTokensPerCall,
      exceedsMax: estimatedInputTokens > this.config.limits.maxInputTokensPerCall,
    };
  }
}
