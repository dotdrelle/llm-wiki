import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LLMService } from '../src/services/llmService.ts';
import type { LlmConfig } from '../src/types.ts';
import type { WorkspaceService } from '../src/services/workspaceService.ts';
import type { WikiPage } from '../src/types.ts';
import { readWorkspaceOverview, regenerateWikiIndex } from '../src/services/wikiIndexService.ts';
import {
  applyWorkspaceOverview,
  draftWorkspaceOverview,
  readWorkspaceOverviewDraft,
  readWorkspaceOverviewEvidence,
  saveWorkspaceOverviewDraft,
} from '../src/services/workspaceOverviewService.ts';

const sourcePage: WikiPage = {
  absolutePath: '/workspace/wiki/sources/source-note.md',
  relativePath: 'wiki/sources/source-note.md',
  name: 'source-note',
  type: 'source',
  content: '# Source note\n\nThe evidence describes the project purpose.\n',
};

describe('workspace overview', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('persists the review draft with its separate evidence record', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-overview-draft-'));
    const workspace = { paths: { rootDir: root } } as unknown as WorkspaceService;
    const overview = 'A cited paragraph. [src: wiki/sources/source-note.md]';
    const evidence = {
      paragraphs: [[{
        path: 'wiki/sources/source-note.md',
        quote: 'The evidence describes the project purpose.',
      }]],
    };
    await saveWorkspaceOverviewDraft(workspace, overview, evidence);
    expect(await readWorkspaceOverviewDraft(workspace)).toBe(`${overview}\n`);
    expect(await readWorkspaceOverviewEvidence(workspace)).toEqual(evidence);
  });

  it('drafts from workspace evidence and requires each content paragraph to cite a supplied page', async () => {
    let requestSystem = '';
    let requestOutputCap = 0;
    const workspace = {
      listWikiPages: async () => [sourcePage],
      listIngestedSourcePages: async () => [],
    } as unknown as WorkspaceService;
    const llm = {
      completeJson: async (request: { system: string; maxOutputTokens?: number }) => {
        requestSystem = request.system;
        requestOutputCap = request.maxOutputTokens ?? 0;
        return {
          paragraphs: [{
            text: 'This source-backed summary describes the workspace purpose and context.',
            evidence: [{ path: 'wiki/sources/source-note.md', quote: 'The evidence describes the project purpose.' }],
          }],
        };
      },
    } as unknown as LLMService;
    const draft = await draftWorkspaceOverview({
      workspace,
      llm,
      contextSize: 4096,
      llmConfig: {
        provider: 'openai-compatible',
        engine: 'albert',
        model: 'openai/gpt-oss-120b',
      } as LlmConfig,
    });
    expect(draft.evidencePaths).toEqual(['wiki/sources/source-note.md']);
    expect(draft.overview).toContain('[src: wiki/sources/source-note.md]');
    expect(draft.evidence.paragraphs[0]?.[0]?.quote).toBe('The evidence describes the project purpose.');
    expect(requestSystem).toContain('Do not assume a business domain');
    expect(requestSystem).toContain('use it consistently in every heading and paragraph');
    expect(requestOutputCap).toBe(3_600);

    const invalid = {
      completeJson: async () => ({
        paragraphs: [{
          text: 'A statement that refers to evidence but invents a source quote.',
          evidence: [{ path: 'wiki/sources/source-note.md', quote: 'Fabricated evidence passage.' }],
        }],
      }),
    } as unknown as LLMService;
    await expect(draftWorkspaceOverview({ workspace, llm: invalid }))
      .rejects.toThrow('does not match supplied evidence');
  });

  it('samples notes, concepts, and archives, including evidence from later sections', async () => {
    const conceptPage: WikiPage = {
      ...sourcePage,
      relativePath: 'wiki/concepts/example/subject.md',
      type: 'concept',
      content: '# Subject\n\nA concept view across the project.\n',
    };
    const archivePage: WikiPage = {
      ...sourcePage,
      relativePath: 'raw/ingested/original.md',
      type: 'other',
      content: [
        '# Original',
        '',
        '## General',
        `${'General archived discussion without the target detail. '.repeat(25)}`,
        '',
        '## Distinctive detail',
        'The original records a distinctive late-section constraint for this project.',
      ].join('\n'),
    };
    let prompt = '';
    const workspace = {
      listWikiPages: async () => [sourcePage, conceptPage],
      listIngestedSourcePages: async () => [archivePage],
    } as unknown as WorkspaceService;
    const llm = {
      completeJson: async (request: { user: string }) => {
        prompt = request.user;
        return {
          paragraphs: [{
            text: 'The project has a documented late-section constraint worth retaining in its overview.',
            evidence: [{
              path: archivePage.relativePath,
              quote: 'The original records a distinctive late-section constraint for this project.',
            }],
          }],
        };
      },
    } as unknown as LLMService;
    const draft = await draftWorkspaceOverview({ workspace, llm, contextSize: 4096 });
    expect(draft.evidencePaths).toContain('wiki/sources/source-note.md');
    expect(draft.evidencePaths).toContain('wiki/concepts/example/subject.md');
    expect(draft.evidencePaths).toContain('raw/ingested/original.md');
    expect(prompt).toContain('The original records a distinctive late-section constraint');
  });

  it('rejects a quote that joins separate excerpt fragments with an omission marker', async () => {
    const archivePage: WikiPage = {
      ...sourcePage,
      relativePath: 'raw/ingested/long-original.md',
      type: 'other',
      content: `# Original\n\n${'A'.repeat(520)}MIDDLE DETAIL${'B'.repeat(520)}`,
    };
    const workspace = {
      listWikiPages: async () => [],
      listIngestedSourcePages: async () => [archivePage],
    } as unknown as WorkspaceService;
    const llm = {
      completeJson: async (request: { user: string }) => {
        const excerpt = request.user.split('### raw/ingested/long-original.md\n')[1]!.trim();
        const marker = excerpt.indexOf('…');
        return {
          paragraphs: [{
            text: 'The original documents a meaningful project detail from the supplied page.',
            evidence: [{ path: archivePage.relativePath, quote: excerpt.slice(marker - 24, marker + 24) }],
          }],
        };
      },
    } as unknown as LLMService;

    await expect(draftWorkspaceOverview({ workspace, llm, contextSize: 4096 }))
      .rejects.toThrow('no longer matches the workspace');
  });

  it('applies a reviewed overview only after every citation resolves and keeps generated sections', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-overview-'));
    const indexPath = path.join(root, 'wiki/index.md');
    await mkdir(path.dirname(indexPath), { recursive: true });
    const initial = [
      '# Wiki Index',
      '',
      '<!-- wiki-index-overview:start -->',
      'Old overview.',
      '<!-- wiki-index-overview:end -->',
      '',
      '## Concepts',
      '',
      '- [Existing](concepts/existing.md)',
      '',
    ].join('\n');
    await writeFile(indexPath, initial);
    const workspace = {
      paths: { rootDir: root, wikiIndexPath: indexPath },
      listWikiPages: async () => [sourcePage],
      listIngestedSourcePages: async () => [],
      readIndex: async () => readFile(indexPath, 'utf8'),
    } as unknown as WorkspaceService;

    const reviewed = 'A source-backed summary. [src: wiki/sources/source-note.md]';
    const evidence = {
      paragraphs: [[{
        path: 'wiki/sources/source-note.md',
        quote: 'The evidence describes the project purpose.',
      }]],
    };
    await applyWorkspaceOverview(workspace, reviewed, evidence);
    const updated = await readFile(indexPath, 'utf8');
    expect(updated).toContain(reviewed);
    expect(updated).toContain('## Concepts');

    await expect(applyWorkspaceOverview(workspace,
      'A stale citation. [src: wiki/sources/missing.md]', evidence))
      .rejects.toThrow('pages that were not supplied');
    expect(await readFile(indexPath, 'utf8')).toBe(updated);

    await expect(applyWorkspaceOverview(workspace, reviewed, {
      paragraphs: [[{
        path: 'wiki/sources/source-note.md',
        quote: 'Evidence that was removed from the source.',
      }]],
    })).rejects.toThrow('no longer matches the workspace');
    expect(await readFile(indexPath, 'utf8')).toBe(updated);
  });

  it('adopts an unmarked legacy index on explicit apply and keeps an exact backup', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-overview-legacy-index-'));
    const indexPath = path.join(root, 'wiki/index.md');
    const notePath = path.join(root, 'wiki/sources/source-note.md');
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(notePath), { recursive: true });
    const legacy = [
      '---',
      'type: index',
      'title: Older workspace map',
      '---',
      '# Older workspace map',
      '',
      'Carefully written context that predates the overview markers.',
      '',
      '## Old navigation',
      '',
      '- [Source](sources/source-note.md)',
      '',
    ].join('\n');
    await writeFile(indexPath, legacy);
    await writeFile(notePath, sourcePage.content);
    const workspace = {
      paths: {
        rootDir: root,
        wikiIndexPath: indexPath,
        internalDir: path.join(root, '.wiki'),
      },
      listWikiPages: async () => [sourcePage],
      listIngestedSourcePages: async () => [],
      readIndex: async () => readFile(indexPath, 'utf8'),
    } as unknown as WorkspaceService;
    const overview = 'The project purpose is documented in its source note. [src: wiki/sources/source-note.md]';
    const evidence = {
      paragraphs: [[{
        path: 'wiki/sources/source-note.md',
        quote: 'The evidence describes the project purpose.',
      }]],
    };

    const result = await applyWorkspaceOverview(workspace, overview, evidence);
    expect(result.legacyBackupPath).toBe('.wiki/index-legacy.md');
    expect(await readFile(path.join(root, result.legacyBackupPath!), 'utf8')).toBe(legacy);
    const adopted = await readFile(indexPath, 'utf8');
    expect(readWorkspaceOverview(adopted)).toBe(overview);
    expect(adopted).toContain('## Project knowledge');
    expect(adopted).toContain('## Archived documents');
    expect(adopted).toContain('[Source note](sources/source-note.md)');

    const regenerated = await regenerateWikiIndex(root);
    expect(regenerated.status).toBe('written');
    expect(readWorkspaceOverview(await readFile(indexPath, 'utf8'))).toBe(overview);
  });

  it('refuses to replace a different existing legacy index backup', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-overview-legacy-conflict-'));
    const indexPath = path.join(root, 'wiki/index.md');
    const notePath = path.join(root, 'wiki/sources/source-note.md');
    const backupPath = path.join(root, '.wiki/index-legacy.md');
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(notePath), { recursive: true });
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(indexPath, '# Current legacy index\n');
    await writeFile(backupPath, '# Different legacy index\n');
    await writeFile(notePath, sourcePage.content);
    const workspace = {
      paths: { rootDir: root, wikiIndexPath: indexPath, internalDir: path.join(root, '.wiki') },
      listWikiPages: async () => [sourcePage],
      listIngestedSourcePages: async () => [],
      readIndex: async () => readFile(indexPath, 'utf8'),
    } as unknown as WorkspaceService;

    await expect(applyWorkspaceOverview(workspace,
      'A source-backed overview for this project. [src: wiki/sources/source-note.md]',
      { paragraphs: [[{ path: 'wiki/sources/source-note.md', quote: 'The evidence describes the project purpose.' }]] },
    )).rejects.toThrow('A different legacy index backup already exists');
    expect(await readFile(indexPath, 'utf8')).toBe('# Current legacy index\n');
  });
});
