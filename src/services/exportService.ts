import {
  buildPolishPrompt,
  buildSectionExportPrompt,
  buildSectionPolishPrompt,
} from '../prompts/exportPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { pathExists } from '../utils/fs.ts';
import { extractSourceCitations, splitMarkdownSections } from '../utils/markdown.ts';
import { resolveInside } from '../utils/path.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { AppConfig } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { RetrievalService } from './retrievalService.ts';
import type { WorkspaceService } from './workspaceService.ts';
import path from 'node:path';

export interface ExportProgress {
  phase: 'read' | 'source' | 'llm' | 'polish';
  path?: string;
  section?: string;
  index?: number;
  total?: number;
  citations?: number;
}

export interface ExportOptions {
  polish?: boolean;
}

export interface ExportResult {
  content: string;
  warnings: string[];
}

// Hard bound per section call: a section is a bounded unit of work, never a
// full-document generation.
const SECTION_MAX_OUTPUT_TOKENS = 3000;
// A regenerated section must not shrink below this share of the original
// body: export expands content, it never summarizes it.
const MIN_EXPANSION_RATIO = 0.5;
const MIN_POLISH_RATIO = 0.6;

interface ExportSection {
  headingPath: string[];
  headingLevel: number;
  headingText: string;
  markdown: string;
}

// Tolerant citation-marker matcher: models sometimes reproduce markers with
// extra spaces ("[ src: ... ]") copied from source fragments.
const CITATION_MARKER = /\s*\[\s*src\s*:[^\]]*\]/gi;

export function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER, '');
}

function sectionBody(section: ExportSection): string {
  const lines = section.markdown.split('\n');
  if (section.headingLevel > 0 && /^#{1,6}\s/.test(lines[0] ?? '')) {
    return lines.slice(1).join('\n').trim();
  }
  return section.markdown.trim();
}

function stripLeadingHeading(candidate: string, headingText: string): string {
  const lines = candidate.trim().split('\n');
  const first = lines[0]?.trim() ?? '';
  const headingMatch = /^#{1,6}\s+(.*)$/.exec(first);
  if (headingMatch && headingMatch[1].trim() === headingText.trim()) {
    return lines.slice(1).join('\n').trim();
  }
  return candidate.trim();
}

/**
 * Demote markdown headings to bold paragraphs (outside code fences). Sections
 * are leaf segments of the document: a generated body must not introduce new
 * headings, but the content under a spurious heading is usually worth keeping.
 */
export function demoteMarkdownHeadings(text: string): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^`{3,}/.test(line.trim())) inFence = !inFence;
      const heading = !inFence ? /^#{1,6}\s+(.+?)\s*$/.exec(line) : null;
      if (!heading) return line;
      const title = heading[1].replace(/^\*\*|\*\*$/g, '');
      return `**${title}**`;
    })
    .join('\n');
}

function containsHeading(text: string): boolean {
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^`{3,}/.test(line.trim())) inFence = !inFence;
    if (!inFence && /^#{1,6}\s/.test(line)) return true;
  }
  return false;
}

export function extractNumericTokens(text: string): string[] {
  const normalized = text.replace(/[\u00A0\u202F]/g, ' ');
  const tokens = normalized.match(/\d+(?:[.,]\d+)*\s?%?/g) ?? [];
  return [
    ...new Set(
      tokens
        .map((token) => token.replace(/\s/g, ''))
        .filter((token) => token.includes('%') || token.replace(/\D/g, '').length >= 2),
    ),
  ];
}

export function sectionValidationIssue(
  originalBody: string,
  candidateBody: string,
  minRatio: number,
): string | undefined {
  const candidate = candidateBody.trim();
  if (!candidate) return 'empty_output';
  if (containsHeading(candidate)) return 'heading_added';
  // Citation markers are removed from regenerated sections by design: they
  // must not count as content or contribute numeric tokens (source filenames
  // often contain digit sequences, e.g. [src: raw/ingested/2c4953e3-...]).
  const original = originalBody.replace(CITATION_MARKER, ' ');
  const originalLength = original.trim().length;
  if (originalLength > 0 && candidate.length < originalLength * minRatio) {
    return 'content_loss';
  }
  const candidateNormalized = candidate.replace(/[\u00A0\u202F\s]/g, '');
  const missing = extractNumericTokens(original).filter(
    (token) => !candidateNormalized.includes(token),
  );
  if (missing.length > 0) return `numbers_lost:${missing.slice(0, 5).join(',')}`;
  return undefined;
}

function citedSourceCandidates(cited: string): string[] {
  const normalized = cited.replace(/^\.\//, '');
  const candidates = [normalized];
  if (!normalized.startsWith('wiki/')) {
    candidates.push(`wiki/sources/${path.basename(normalized)}`);
  }
  return candidates;
}

export async function expandDeliverable(
  deliverablePath: string,
  config: AppConfig,
  workspace: WorkspaceService,
  retrieval: RetrievalService,
  llm: LLMService,
  logger: TraceLogger,
  onProgress?: (progress: ExportProgress) => void,
  options: ExportOptions = {},
): Promise<ExportResult> {
  onProgress?.({ phase: 'read', path: deliverablePath });
  const absolutePath = resolveInside(workspace.paths.rootDir, deliverablePath);
  const content = await workspace.readTextFile(absolutePath);
  const profileSection = await workspace.loadProfileSection(config.limits.maxProfileChars);
  const promptCtx = buildPromptContext(config, { profileSection });
  const warnings: string[] = [];

  const document = splitMarkdownSections(content);
  const sections: ExportSection[] = [
    ...(document.preamble
      ? [
          {
            headingPath: [] as string[],
            headingLevel: 0,
            headingText: '',
            markdown: document.preamble,
          },
        ]
      : []),
    ...document.sections,
  ];

  const sectionsWithCitations = sections.filter(
    (section) => extractSourceCitations(section.markdown).length > 0,
  );

  await logger.info('export:start', {
    deliverable: deliverablePath,
    sections: sections.length,
    sectionsWithCitations: sectionsWithCitations.length,
  });

  if (sectionsWithCitations.length === 0) {
    await logger.warn('export:no-sources', { deliverable: deliverablePath });
    if (!options.polish) {
      return { content, warnings };
    }

    // Legacy polish-only mode: no citations to resolve, polish the document.
    const polishPrompt = buildPolishPrompt(content, promptCtx);
    onProgress?.({ phase: 'polish', path: deliverablePath, citations: 0 });
    const result = await llm.completeText({
      ...polishPrompt,
      label: 'export:polish',
      logger,
    });
    await logger.info('export:done', { outputChars: result.length, mode: 'polish-only' });
    return { content: result, warnings };
  }

  const total = sectionsWithCitations.length;
  let index = 0;
  const rendered = new Map<ExportSection, string>();
  const regenerated = new Set<ExportSection>();

  for (const section of sectionsWithCitations) {
    index += 1;
    const sectionLabel = section.headingText || '(preamble)';
    const citedPaths = [...new Set(extractSourceCitations(section.markdown))];
    onProgress?.({
      phase: 'source',
      path: deliverablePath,
      section: sectionLabel,
      index,
      total,
      citations: citedPaths.length,
    });

    const allowedSources = [...new Set(citedPaths.flatMap(citedSourceCandidates))];
    const originalBody = sectionBody(section);
    const query = [section.headingPath.join(' '), originalBody.slice(0, 300)]
      .join(' ')
      .replace(/\[src:[^\]]*\]/gi, ' ')
      .trim();

    let fragments: Array<{ path: string; heading?: string; content: string }> = [];
    try {
      const results = await retrieval.search(query, {
        allowedSources,
        limit: config.retrieval.maxContextFiles,
      });
      // Strip citation markers from the fragments themselves: wiki pages
      // carry their own [src: ...] markers, and the model tends to copy them
      // (sometimes reformatted) into the generated section.
      fragments = results.map((result) => ({
        path: result.page.relativePath,
        heading: result.chunk?.headingPath.join(' > '),
        content: stripCitationMarkers(
          result.chunk?.content ??
            result.page.content.slice(0, config.retrieval.maxChunkChars),
        ),
      }));
    } catch (error) {
      await logger.warn('export:retrieval-failed', {
        section: sectionLabel,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (fragments.length === 0) {
      // Fallback: no indexed content for the cited sources — inject the raw
      // files directly (bounded), as the legacy export did.
      for (const cited of citedPaths) {
        let sourceAbsolute: string;
        try {
          sourceAbsolute = resolveInside(workspace.paths.rootDir, cited);
        } catch {
          warnings.push(`source path escapes workspace: ${cited} (section "${sectionLabel}")`);
          continue;
        }
        if (!(await pathExists(sourceAbsolute))) {
          warnings.push(`source not found: ${cited} (section "${sectionLabel}")`);
          continue;
        }
        const raw = stripCitationMarkers(await workspace.readTextFile(sourceAbsolute));
        fragments.push({
          path: cited,
          content:
            raw.length > config.retrieval.maxSourceChars
              ? `${raw.slice(0, config.retrieval.maxSourceChars)}\n...[source truncated]`
              : raw,
        });
      }
      if (fragments.length > 0) {
        await logger.warn('export:raw-fallback', {
          section: sectionLabel,
          sources: fragments.map((fragment) => fragment.path),
        });
      }
    }

    if (fragments.length === 0) {
      // Nothing to ground an expansion on: keep the section untouched rather
      // than inviting invention.
      warnings.push(
        `section "${sectionLabel}" kept unchanged: no resolvable source among [${citedPaths.join(', ')}]`,
      );
      await logger.warn('export:section-skipped', {
        section: sectionLabel,
        cited: citedPaths,
      });
      continue;
    }

    onProgress?.({
      phase: 'llm',
      path: deliverablePath,
      section: sectionLabel,
      index,
      total,
      citations: fragments.length,
    });

    const prompt = buildSectionExportPrompt(
      {
        headingPath: section.headingPath,
        headingText: section.headingText,
        markdown: section.markdown,
        fragments,
      },
      promptCtx,
    );

    let accepted: string | undefined;
    let lastIssue: string | undefined;
    for (let attempt = 1; attempt <= 2 && !accepted; attempt += 1) {
      // Retrying with an identical prompt tends to reproduce the same
      // mistake: feed the rejection reason back into the second attempt.
      const retryFeedback =
        attempt > 1 && lastIssue
          ? [
              '',
              '# Previous attempt rejected',
              lastIssue.startsWith('numbers_lost:')
                ? `Your previous answer dropped these values from the current section content: ${lastIssue.slice('numbers_lost:'.length)}. Every number, percentage, date, and identifier present in the section MUST appear verbatim in your answer.`
                : lastIssue === 'content_loss'
                  ? 'Your previous answer was shorter than the current section content. Keep everything already stated and only add or clarify; do not summarize.'
                  : `Your previous answer was rejected (${lastIssue}). Follow the rules strictly.`,
            ].join('\n')
          : '';
      const response = await llm.completeText({
        ...prompt,
        user: `${prompt.user}${retryFeedback}`,
        label: 'export:section',
        logger,
        maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS,
        traceData: { section: sectionLabel, attempt },
      });
      let candidate = stripCitationMarkers(
        stripLeadingHeading(response, section.headingText),
      );
      lastIssue = sectionValidationIssue(originalBody, candidate, MIN_EXPANSION_RATIO);
      if (lastIssue === 'heading_added') {
        // Recoverable: keep the content, demote the spurious headings to bold
        // text so the document structure stays intact, then re-validate.
        candidate = demoteMarkdownHeadings(candidate);
        lastIssue = sectionValidationIssue(originalBody, candidate, MIN_EXPANSION_RATIO);
        if (!lastIssue) {
          await logger.info('export:headings-demoted', {
            section: sectionLabel,
            attempt,
          });
        }
      }
      if (!lastIssue) {
        accepted = candidate;
      } else {
        await logger.warn('export:section-rejected', {
          section: sectionLabel,
          attempt,
          issue: lastIssue,
        });
      }
    }

    if (!accepted) {
      warnings.push(
        `section "${sectionLabel}" kept unchanged: generated content failed validation (${lastIssue})`,
      );
      continue;
    }

    const headingLine =
      section.headingLevel > 0
        ? `${'#'.repeat(section.headingLevel)} ${section.headingText}`
        : '';
    rendered.set(section, headingLine ? `${headingLine}\n\n${accepted}` : accepted);
    regenerated.add(section);
  }

  if (options.polish && regenerated.size > 0) {
    let polishIndex = 0;
    for (const section of regenerated) {
      polishIndex += 1;
      const sectionLabel = section.headingText || '(preamble)';
      onProgress?.({
        phase: 'polish',
        path: deliverablePath,
        section: sectionLabel,
        index: polishIndex,
        total: regenerated.size,
      });
      const current = rendered.get(section)!;
      const currentBody = sectionBody({ ...section, markdown: current });
      const prompt = buildSectionPolishPrompt(section.headingPath, currentBody, promptCtx);
      try {
        const response = await llm.completeText({
          ...prompt,
          label: 'export:polish-section',
          logger,
          maxOutputTokens: SECTION_MAX_OUTPUT_TOKENS,
          traceData: { section: sectionLabel },
        });
        const candidate = stripCitationMarkers(
          stripLeadingHeading(response, section.headingText),
        );
        const issue = sectionValidationIssue(currentBody, candidate, MIN_POLISH_RATIO);
        if (issue) {
          await logger.warn('export:polish-rejected', {
            section: sectionLabel,
            issue,
          });
          continue;
        }
        const headingLine =
          section.headingLevel > 0
            ? `${'#'.repeat(section.headingLevel)} ${section.headingText}`
            : '';
        rendered.set(
          section,
          headingLine ? `${headingLine}\n\n${candidate}` : candidate,
        );
      } catch (error) {
        await logger.warn('export:polish-failed', {
          section: sectionLabel,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const parts = [
    document.frontmatter.trim(),
    ...sections.map((section) => rendered.get(section) ?? section.markdown),
  ].filter((part) => part.length > 0);

  const result = `${parts.join('\n\n')}\n`;
  await logger.info('export:done', {
    outputChars: result.length,
    regeneratedSections: regenerated.size,
    keptSections: sections.length - regenerated.size,
    warnings: warnings.length,
  });
  for (const warning of warnings) {
    await logger.warn('export:warning', { message: warning });
  }
  return { content: result, warnings };
}

export function exportOutputPath(deliverablePath: string, options: ExportOptions = {}): string {
  const ext = path.extname(deliverablePath);
  const base = deliverablePath.slice(0, deliverablePath.length - ext.length);

  if (!options.polish && base.endsWith('.export')) {
    return deliverablePath;
  }

  if (options.polish && base.endsWith('.export.polished')) {
    return deliverablePath;
  }

  if (options.polish && !base.endsWith('.export')) {
    return `${base}.export.polished${ext}`;
  }

  if (options.polish) {
    return `${base}.polished${ext}`;
  }

  return `${base}.export${ext}`;
}
