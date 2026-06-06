import type { AppConfig } from '../types.ts';

export interface PromptContext {
  language: string;
  runDate: string;
  profileSection?: string;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildPromptContext(
  config: AppConfig,
  options: { date?: Date; profileSection?: string } = {},
): PromptContext {
  return {
    language: config.language,
    runDate: formatLocalDate(options.date ?? new Date()),
    profileSection: options.profileSection,
  };
}

export function buildSystemPreamble({ language, runDate, profileSection }: PromptContext): string {
  const parts = [
    `Today's date: ${runDate}.`,
    `Language: write all generated user-facing content in ${language}. This overrides the language of user input, source documents, templates, and wiki context.`,
  ];
  if (profileSection) {
    parts.push(profileSection);
  }
  return parts.join('\n');
}
