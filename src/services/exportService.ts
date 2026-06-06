import { buildExportPrompt, buildPolishPrompt } from '../prompts/exportPrompt.ts';
import { buildPromptContext } from '../prompts/systemPreamble.ts';
import { pathExists } from '../utils/fs.ts';
import { extractSourceCitations } from '../utils/markdown.ts';
import { resolveInside } from '../utils/path.ts';
import type { TraceLogger } from './traceLogger.ts';
import type { AppConfig } from '../types.ts';
import type { LLMService } from './llmService.ts';
import type { WorkspaceService } from './workspaceService.ts';
import path from 'node:path';

export interface ExportProgress {
  phase: 'read' | 'source' | 'llm' | 'polish';
  path?: string;
  index?: number;
  total?: number;
  citations?: number;
}

export interface ExportOptions {
  polish?: boolean;
}

export async function expandDeliverable(
  deliverablePath: string,
  config: AppConfig,
  workspace: WorkspaceService,
  llm: LLMService,
  logger: TraceLogger,
  onProgress?: (progress: ExportProgress) => void,
  options: ExportOptions = {},
): Promise<string> {
  onProgress?.({ phase: 'read', path: deliverablePath });
  const absolutePath = resolveInside(workspace.paths.rootDir, deliverablePath);
  const content = await workspace.readTextFile(absolutePath);
  const citedPaths = [...new Set(extractSourceCitations(content))];
  const profileSection = await workspace.loadProfileSection(config.limits.maxProfileChars);

  await logger.info('export:start', { deliverable: deliverablePath, citations: citedPaths.length });

  const sources: Array<{ path: string; content: string }> = [];
  for (const [index, cited] of citedPaths.entries()) {
    onProgress?.({
      phase: 'source',
      path: cited,
      index: index + 1,
      total: citedPaths.length,
      citations: citedPaths.length,
    });

    let sourceAbsolute: string;
    try {
      sourceAbsolute = resolveInside(workspace.paths.rootDir, cited);
    } catch {
      await logger.warn('export:skip', { reason: 'path escapes workspace', path: cited });
      continue;
    }

    if (!(await pathExists(sourceAbsolute))) {
      await logger.warn('export:skip', { reason: 'file not found', path: cited });
      continue;
    }

    const raw = await workspace.readTextFile(sourceAbsolute);
    const capped =
      raw.length > config.retrieval.maxSourceChars
        ? `${raw.slice(0, config.retrieval.maxSourceChars)}\n...[source truncated]`
        : raw;

    sources.push({ path: cited, content: capped });
    await logger.info('export:source', { path: cited, chars: capped.length });
  }

  if (sources.length === 0) {
    await logger.warn('export:no-sources', { deliverable: deliverablePath });
    if (!options.polish) {
      return content;
    }

    const promptCtx = buildPromptContext(config, { profileSection });
    const polishPrompt = buildPolishPrompt(content, promptCtx);
    await logger.debug('export:polish-prompt', {
      chars: polishPrompt.system.length + polishPrompt.user.length,
      mode: 'polish-only',
    });
    onProgress?.({ phase: 'polish', path: deliverablePath, citations: 0 });
    const result = await llm.completeText({ ...polishPrompt, label: 'export:polish', logger });
    await logger.info('export:done', { outputChars: result.length, mode: 'polish-only' });
    return result;
  }

  const promptCtx = buildPromptContext(config, { profileSection });
  const prompt = buildExportPrompt(content, sources, promptCtx);
  await logger.debug('export:prompt', { chars: prompt.system.length + prompt.user.length });

  onProgress?.({ phase: 'llm', path: deliverablePath, citations: sources.length });
  let result = await llm.completeText({ ...prompt, label: 'export', logger });

  if (options.polish) {
    const polishPrompt = buildPolishPrompt(result, promptCtx);
    await logger.debug('export:polish-prompt', {
      chars: polishPrompt.system.length + polishPrompt.user.length,
    });
    onProgress?.({ phase: 'polish', path: deliverablePath, citations: sources.length });
    result = await llm.completeText({ ...polishPrompt, label: 'export:polish', logger });
  }

  await logger.info('export:done', { outputChars: result.length });
  return result;
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
