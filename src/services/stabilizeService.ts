import { buildStabilizeSectionPrompt } from '../prompts/stabilizePrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import {
  normalizeHeadingPathKey,
  splitMarkdownSections,
  type MarkdownSection,
} from '../utils/markdown.ts';
import { hashText } from '../utils/hash.ts';
import type { AppConfig, StabilizeDiff, StabilizeResult } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { TraceLogger } from './traceLogger.ts';

function emptyDiff(): StabilizeDiff {
  return {
    kept: [],
    merged: [],
    inserted: [],
    removed: [],
  };
}

function sectionKey(section: MarkdownSection): string {
  return normalizeHeadingPathKey(section.headingPath);
}

function sectionLabel(section: MarkdownSection): string {
  return section.headingPath.join(' > ') || '(document)';
}

function assembleMarkdown(frontmatter: string, preamble: string, sections: string[]): string {
  return [frontmatter.trimEnd(), preamble.trim(), ...sections.map((section) => section.trim())]
    .filter(Boolean)
    .join('\n\n')
    .trim()
    .concat('\n');
}

export class StabilizeService {
  private readonly config: AppConfig;
  private readonly llm: LLMService;
  private readonly logger?: TraceLogger;

  constructor(config: AppConfig, llm: LLMService, logger?: TraceLogger) {
    this.config = config;
    this.llm = llm;
    this.logger = logger;
  }

  async stabilize(oldMarkdown: string, newMarkdown: string): Promise<StabilizeResult> {
    const startedAt = Date.now();
    const oldDocument = splitMarkdownSections(oldMarkdown);
    const newDocument = splitMarkdownSections(newMarkdown);
    const diff = emptyDiff();

    if (oldDocument.sections.length === 0 && newDocument.sections.length === 0) {
      const prompt = buildStabilizeSectionPrompt(
        {
          headingPath: [],
          oldSection: oldMarkdown,
          newSection: newMarkdown,
        },
        buildPromptContext(this.config),
      );
      await this.logger?.info('build:stabilize-section-llm', {
        headingPath: [],
        oldChars: oldMarkdown.length,
        newChars: newMarkdown.length,
        fallback: 'full-document',
      });
      const markdown = await this.llm.completeText({
        ...prompt,
        label: 'build:stabilize',
        logger: this.logger,
      });
      diff.merged.push('(document)');
      await this.logger?.info('build:stabilize-done', {
        kept: diff.kept.length,
        merged: diff.merged.length,
        inserted: diff.inserted.length,
        removed: diff.removed.length,
        durationMs: Date.now() - startedAt,
      });
      return { markdown, diff };
    }

    const oldByKey = new Map(oldDocument.sections.map((section) => [sectionKey(section), section]));
    const newKeys = new Set(newDocument.sections.map(sectionKey));
    const outputSections: string[] = [];

    if (oldDocument.preamble && newDocument.preamble) {
      if (hashText(oldDocument.preamble) === hashText(newDocument.preamble)) {
        diff.kept.push('(preamble)');
      } else {
        diff.inserted.push('(preamble)');
      }
    } else if (newDocument.preamble) {
      diff.inserted.push('(preamble)');
    } else if (oldDocument.preamble) {
      diff.removed.push('(preamble)');
    }

    for (const newSection of newDocument.sections) {
      const key = sectionKey(newSection);
      const oldSection = oldByKey.get(key);
      if (!oldSection) {
        diff.inserted.push(sectionLabel(newSection));
        outputSections.push(newSection.markdown);
        continue;
      }

      if (hashText(oldSection.markdown) === hashText(newSection.markdown)) {
        diff.kept.push(sectionLabel(newSection));
        await this.logger?.debug('build:stabilize-section-skip', {
          headingPath: newSection.headingPath,
          reason: 'hash-match',
        });
        outputSections.push(oldSection.markdown);
        continue;
      }

      diff.merged.push(sectionLabel(newSection));
      await this.logger?.info('build:stabilize-section-llm', {
        headingPath: newSection.headingPath,
        oldChars: oldSection.markdown.length,
        newChars: newSection.markdown.length,
      });
      const prompt = buildStabilizeSectionPrompt(
        {
          headingPath: newSection.headingPath,
          oldSection: oldSection.markdown,
          newSection: newSection.markdown,
        },
        buildPromptContext(this.config),
      );
      outputSections.push(
        await this.llm.completeText({
          ...prompt,
          label: 'build:stabilize',
          logger: this.logger,
        }),
      );
    }

    for (const oldSection of oldDocument.sections) {
      if (!newKeys.has(sectionKey(oldSection))) {
        diff.removed.push(sectionLabel(oldSection));
      }
    }

    const markdown = assembleMarkdown(
      newDocument.frontmatter,
      newDocument.preamble,
      outputSections,
    );
    await this.logger?.info('build:stabilize-done', {
      kept: diff.kept.length,
      merged: diff.merged.length,
      inserted: diff.inserted.length,
      removed: diff.removed.length,
      durationMs: Date.now() - startedAt,
    });
    return { markdown, diff };
  }
}
