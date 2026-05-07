import type { AppConfig } from '../types.ts';

export interface PromptContext {
  language: string;
  runDate: string;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildPromptContext(config: AppConfig, date = new Date()): PromptContext {
  return {
    language: config.language,
    runDate: formatLocalDate(date),
  };
}

export function buildSystemPreamble({ language, runDate }: PromptContext): string {
  return [
    `Today's date: ${runDate}.`,
    `Language: write all generated user-facing content in ${language}. This overrides the language of user input, source documents, templates, and wiki context.`,
  ].join('\n');
}
