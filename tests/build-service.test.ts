import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildService } from '../src/services/buildService.ts';
import type { LLMService } from '../src/services/llmService.ts';
import type { RetrievalService } from '../src/services/retrievalService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';
import type { AppConfig, SearchResult, WikiPage } from '../src/types.ts';

function createConfig(root: string): AppConfig {
  return {
    wikiRoot: root,
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    build: {
      refreshOnIngest: true,
        slotBatchSize: 5,
    },
    retrieval: {
      maxContextFiles: 8,
        maxChunksPerPage: 2,
        maxChunkChars: 3000,
        maxSourceChars: 8000,
    },
  };
}

class FakeLLMService {
  async completeJson() {
    return {
      replacements: [
        {
          id: 'instruction-1',
          content: 'Documented summary. [src: wiki/concepts/local-first.md]',
        },
      ],
    };
  }
}

class FakeRetrievalService {
  async search(): Promise<SearchResult[]> {
    return [];
  }
  async warmCache(): Promise<WikiPage[]> {
    return [];
  }
}

describe('build service', () => {
  it('renders a template and stores build state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(
      path.join(root, 'wiki', 'index.md'),
      '# Wiki Index\n\n- [[local-first]]\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'wiki', 'concepts', 'local-first.md'),
      '# Local First\n\nFacts only. [src: raw/ingested/notes.md]\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['---', 'title: Brief', 'output: brief.md', '---', '', '# Brief', '', '[[INSTRUCTION: Summarize.]]'].join(
        '\n',
      ),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new BuildService(
      config,
      workspace,
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    const results = await service.build();
    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('deliverables/brief.md');

    const output = await workspace.readTextFile(path.join(root, 'deliverables', 'brief.md'));
    expect(output).toContain('Documented summary.');

    const state = await workspace.readBuildState();
    expect(state.deliverables['templates/brief.md']).toBeDefined();
  });
});
