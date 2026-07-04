import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
    language: 'fr',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5:14b',
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      temperature: 0.1,
      timeoutMs: 600000,
    },
    limits: {
      requestsPerMinute: 10,
      maxInputTokensPerCall: 50000,
      targetInputTokensPerCall: 40000,
      maxProfileChars: 4000,
    },
    build: {
      refreshOnIngest: true,
      slotBatchSize: 5,
      maxBuildContextChars: 12000,
    },
    retrieval: {
      maxContextFiles: 8,
      maxChunksPerPage: 2,
      maxChunkChars: 3000,
      maxSourceChars: 8000,
      vector: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        timeoutMs: 600000,
        embeddingModel: 'BAAI/bge-m3',
        rerankEnabled: true,
        rerankerModel: 'BAAI/bge-reranker-v2-m3',
        topK: 120,
        rerankTopK: 80,
        maxResults: 6,
      },
    },
    mcp: {},
  };
}

class FakeLLMService {
  completeJsonCalls = 0;
  completeTextCalls = 0;
  lastJsonRequest?: { system: string; user: string };

  async completeJson(request: { system: string; user: string }) {
    this.completeJsonCalls += 1;
    this.lastJsonRequest = request;
    return {
      replacements: [
        {
          id: 'instruction-1',
          content: 'Documented summary. [src: wiki/concepts/local-first.md]',
        },
      ],
    };
  }

  async completeText(request?: { user?: string }) {
    this.completeTextCalls += 1;
    if (request?.user?.includes('# Candidate section')) {
      return (
        request.user.split('# Candidate section')[1]?.split('---')[0]?.trim() ??
        'Text fallback summary. [src: wiki/concepts/local-first.md]'
      );
    }
    return 'Text fallback summary. [src: wiki/concepts/local-first.md]';
  }
}

class EscapedNewlineLLMService {
  async completeJson() {
    return {
      replacements: [
        {
          id: 'instruction-1',
          content:
            'Intro.\\n\\n### Tableau\\n\\n| Colonne | Source |\\n|---|---|\\n| Valeur | [src: wiki/concepts/local-first.md] |\\n\\n`À confirmer`',
        },
      ],
    };
  }
}

class RepeatedHeadingLLMService {
  async completeJson() {
    return {
      replacements: [
        {
          id: 'instruction-1',
          content: '### Section\n\nBody. [src: wiki/concepts/local-first.md]',
        },
      ],
    };
  }
}

class ShallowHeadingLLMService {
  async completeJson() {
    return {
      replacements: [
        {
          id: 'instruction-1',
          content: '### Child\n\nBody. [src: wiki/concepts/local-first.md]',
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

function wikiPage(relativePath: string, content: string): WikiPage {
  return {
    absolutePath: relativePath,
    relativePath,
    name: path.basename(relativePath, '.md'),
    type: 'concept',
    content,
  };
}

class NamedRetrievalService {
  async search(query: string): Promise<SearchResult[]> {
    if (query.includes('Alpha')) {
      return [
        {
          page: wikiPage('wiki/concepts/alpha.md', '# Alpha\n\nAlpha facts.'),
          score: 10,
        },
      ];
    }
    if (query.includes('Beta')) {
      return [
        {
          page: wikiPage('wiki/concepts/beta.md', '# Beta\n\nBeta facts.'),
          score: 10,
        },
      ];
    }
    if (query.includes('Gamma')) {
      return [
        {
          page: wikiPage('wiki/concepts/gamma.md', '# Gamma\n\nGamma facts.'),
          score: 10,
        },
      ];
    }
    return [
      {
        page: wikiPage('wiki/concepts/overview.md', '# Overview\n\nOverview facts.'),
        score: 10,
      },
    ];
  }

  async warmCache(): Promise<WikiPage[]> {
    return [];
  }
}

class CountingRetrievalService {
  readonly queries: string[] = [];
  readonly rerankQueries: string[] = [];

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    return [
      {
        page: wikiPage(`wiki/concepts/${this.queries.length}.md`, `# ${query}\n\nFacts.`),
        score: 10,
      },
    ];
  }

  async warmCache(): Promise<WikiPage[]> {
    return [];
  }

  async rerankResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    this.rerankQueries.push(query);
    return results;
  }
}

class FinalContextRetrievalService {
  async search(): Promise<SearchResult[]> {
    return [
      {
        page: wikiPage('wiki/index.md', '# Index\n\nShould not be final context.'),
        score: 100,
      },
      {
        page: wikiPage('wiki/log.md', '# Log\n\nShould not be final context.'),
        score: 99,
      },
      {
        page: wikiPage(
          'wiki/sources/old-decision.md',
          '# Old\n\nDecision pending on 2026-03-01.',
        ),
        score: 98,
      },
      {
        page: wikiPage(
          'wiki/sources/new-decision.md',
          '# New\n\nDecision settled on 2026-04-13.',
        ),
        score: 10,
      },
    ];
  }

  async warmCache(): Promise<WikiPage[]> {
    return [];
  }

  async rerankResults(_query: string, results: SearchResult[]): Promise<SearchResult[]> {
    return results;
  }
}

class SplittingLLMService {
  completeJsonCalls = 0;

  async completeJson(request: { user: string }) {
    this.completeJsonCalls += 1;
    if (this.completeJsonCalls === 1) {
      throw new Error(
        'LLM request failed for openai/gpt-5-mini with HTTP 400: Input tokens exceed the configured limit. context_length_exceeded',
      );
    }

    const ids = [...request.user.matchAll(/^## (instruction-\d+)$/gm)].map(
      (match) => match[1],
    );
    return {
      replacements: ids.map((id) => ({
        id,
        content: `Rendered ${id}. [src: wiki/index.md]`,
      })),
    };
  }

  async completeText() {
    return 'Text fallback. [src: wiki/index.md]';
  }
}

class ConcurrentBuildLLMService {
  active = 0;
  maxActive = 0;
  completeJsonCalls = 0;

  async completeJson(request: { user: string }) {
    this.completeJsonCalls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
    const ids = [...request.user.matchAll(/^## (instruction-\d+)$/gm)].map(
      (match) => match[1],
    );
    return {
      replacements: ids.map((id) => ({
        id,
        content: `Rendered ${id}. [src: wiki/index.md]`,
      })),
    };
  }

  async completeText() {
    return 'Text fallback. [src: wiki/index.md]';
  }
}

class IncompleteBatchLLMService {
  completeJsonCalls = 0;

  async completeJson(request: { user: string }) {
    this.completeJsonCalls += 1;
    const ids = [...request.user.matchAll(/^## (instruction-\d+)$/gm)].map(
      (match) => match[1],
    );
    const returnedIds = ids.length > 1 ? ids.slice(0, 1) : ids;
    return {
      replacements: returnedIds.map((id) => ({
        id,
        content: `Rendered ${id}. [src: wiki/index.md]`,
      })),
    };
  }

  async completeText() {
    return 'Text fallback. [src: wiki/index.md]';
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
      [
        '---',
        'title: Brief',
        'output: brief.md',
        '---',
        '',
        '# Brief',
        '',
        '[[INSTRUCTION: Summarize.]]',
      ].join('\n'),
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

    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).toContain('Documented summary.');

    const state = await workspace.readBuildState();
    expect(state.deliverables['templates/brief.md']).toBeDefined();
  });

  it('normalizes escaped markdown line breaks in generated replacements', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-escaped-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '[[INSTRUCTION: Summarize.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new BuildService(
      config,
      workspace,
      new EscapedNewlineLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).not.toContain('\\n');
    expect(output).toContain('### Tableau\n\n| Colonne | Source |');
    expect(output).toContain('`À confirmer`');
  });

  it('removes a generated heading that repeats the template slot heading', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-heading-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '## Section', '', '[[INSTRUCTION: Fill section.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new BuildService(
      config,
      workspace,
      new RepeatedHeadingLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output.match(/Section/g)).toHaveLength(1);
    expect(output).toContain('## Section\n\nBody.');
  });

  it('shifts generated headings below the template slot heading level', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-level-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '### Parent', '', '[[INSTRUCTION: Fill section.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const service = new BuildService(
      config,
      workspace,
      new ShallowHeadingLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).toContain('### Parent\n\n#### Child\n\nBody.');
  });

  it('stabilizes existing deliverables and removes sidecars on normal build', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-stabilize-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'deliverables', 'brief.md'),
      [
        '# Brief',
        '',
        '## Stable',
        '',
        'Keep exact old text.',
        '',
        '## Changed',
        '',
        'Old value.',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '---',
        'output: brief.md',
        '---',
        '',
        '# Brief',
        '',
        '## Stable',
        '',
        'Keep exact old text.',
        '',
        '## Changed',
        '',
        'New value.',
        '',
        '## Added',
        '',
        'New section.',
      ].join('\n'),
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

    const [stabilizedResult] = await service.build({ stabilize: true });
    const outputPath = path.join(root, 'deliverables', 'brief.md');
    const output = await workspace.readTextFile(outputPath);
    const sidecarPath = workspace.deriveChangesSidecarPath(outputPath);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
    const deliverableFiles = await readdir(path.join(root, 'deliverables'));

    expect(stabilizedResult.stabilized?.kept).toContain('Brief > Stable');
    expect(stabilizedResult.stabilized?.merged).toContain('Brief > Changed');
    expect(stabilizedResult.stabilized?.inserted).toContain('Brief > Added');
    expect(output).toContain('Keep exact old text.');
    expect(output).toContain('New value.');
    expect(output).toContain('New section.');
    expect(sidecar.kept).toContain('Brief > Stable');
    expect(deliverableFiles.some((file) => file.startsWith('.tmp.'))).toBe(false);

    await service.build();
    await expect(readFile(sidecarPath, 'utf8')).rejects.toThrow();
  });

  it('renders single-slot openai-compatible templates without JSON first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '[[INSTRUCTION: Summarize.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.llm.provider = 'openai-compatible';
    config.build.slotBatchSize = 1;
    const workspace = new WorkspaceService(config);
    const llm = new FakeLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.completeJsonCalls).toBe(0);
    expect(llm.completeTextCalls).toBe(1);
    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).toContain('Text fallback summary.');
  });

  it('adds build-context rules to build prompts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });
    await mkdir(path.join(root, 'build-context'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'build-context', 'citation.md'),
      '# Citation\n\nCite every assertion with a source marker.',
      'utf8',
    );
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '[[INSTRUCTION: Summarize.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const workspace = new WorkspaceService(config);
    const llm = new FakeLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.lastJsonRequest?.system).toContain(
      'Common generation rules from build-context/',
    );
    expect(llm.lastJsonRequest?.system).toContain('build-context/citation.md');
    expect(llm.lastJsonRequest?.system).toContain(
      'Cite every assertion with a source marker.',
    );
  });

  it('expands build retrieval for named comparison items', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'comparison.md'),
      [
        '# Comparison',
        '',
        '[[INSTRUCTION: Compare the documented candidates: Alpha, Beta, Gamma.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.retrieval.maxContextFiles = 2;
    const workspace = new WorkspaceService(config);
    const llm = new FakeLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new NamedRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.lastJsonRequest?.user).toContain('wiki/concepts/alpha.md');
    expect(llm.lastJsonRequest?.user).toContain('wiki/concepts/beta.md');
    expect(llm.lastJsonRequest?.user).toContain('wiki/concepts/gamma.md');
  });

  it('deduplicates template focus context searches across instructions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '# Brief',
        '',
        '## One',
        '[[INSTRUCTION: Describe: Alpha, Beta.]]',
        '',
        '## Two',
        '[[INSTRUCTION: Summarize: Alpha, Beta.]]',
        '',
        '## Three',
        '[[INSTRUCTION: Decide: Alpha, Beta.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const retrieval = new CountingRetrievalService();
    const service = new BuildService(
      config,
      new WorkspaceService(config),
      new FakeLLMService() as unknown as LLMService,
      retrieval as unknown as RetrievalService,
    );

    await service.build();

    const focusQueries = retrieval.queries.filter((query) =>
      query.includes('démonstration outil solution candidate ACME'),
    );
    expect(focusQueries).toHaveLength(2);
    expect(retrieval.rerankQueries).toHaveLength(3);
    expect(focusQueries.some((query) => query.startsWith('One '))).toBe(false);
    expect(focusQueries.some((query) => query.startsWith('Two '))).toBe(false);
    expect(focusQueries.some((query) => query.startsWith('Three '))).toBe(false);
  });

  it('filters index/log pages and prefers newer dated context in final prompts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '[[INSTRUCTION: Summarize decisions.]]'].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    const llm = new FakeLLMService();
    const service = new BuildService(
      config,
      new WorkspaceService(config),
      llm as unknown as LLMService,
      new FinalContextRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    const userPrompt = llm.lastJsonRequest?.user ?? '';
    expect(userPrompt).not.toContain('wiki/index.md');
    expect(userPrompt).not.toContain('wiki/log.md');
    expect(userPrompt.indexOf('wiki/sources/new-decision.md')).toBeLessThan(
      userPrompt.indexOf('wiki/sources/old-decision.md'),
    );
  });

  it('rebuilds changed-only deliverables when build-context changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });
    await mkdir(path.join(root, 'build-context'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'build-context', 'rules.md'),
      'Initial rules.',
      'utf8',
    );
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      ['# Brief', '', '[[INSTRUCTION: Summarize.]]'].join('\n'),
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

    await service.build();
    const skippedResults = await service.build({ changedOnly: true });
    expect(skippedResults[0].skipped).toBe(true);

    await writeFile(
      path.join(root, 'build-context', 'rules.md'),
      'Updated rules.',
      'utf8',
    );
    const rebuiltResults = await service.build({ changedOnly: true });
    expect(rebuiltResults[0].skipped).toBe(false);
  });

  it('splits an oversized build batch and retries smaller batches', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '# Brief',
        '',
        '[[INSTRUCTION: Fill first.]]',
        '',
        '[[INSTRUCTION: Fill second.]]',
        '',
        '[[INSTRUCTION: Fill third.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.llm.provider = 'openai';
    config.llm.model = 'gpt-5-mini';
    config.build.slotBatchSize = 3;
    const workspace = new WorkspaceService(config);
    const llm = new SplittingLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.completeJsonCalls).toBe(3);
    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).toContain('Rendered instruction-1.');
    expect(output).toContain('Rendered instruction-2.');
    expect(output).toContain('Rendered instruction-3.');
  });

  it('plans build batches by token budget when no slot cap is configured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-plan-budget-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '# Brief',
        '',
        '[[INSTRUCTION: Fill first.]]',
        '',
        '[[INSTRUCTION: Fill second.]]',
        '',
        '[[INSTRUCTION: Fill third.]]',
        '',
        '[[INSTRUCTION: Fill fourth.]]',
        '',
        '[[INSTRUCTION: Fill fifth.]]',
        '',
        '[[INSTRUCTION: Fill sixth.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.build.slotBatchSize = undefined;
    config.limits.targetInputTokensPerCall = 50000;
    const service = new BuildService(
      config,
      new WorkspaceService(config),
      new FakeLLMService() as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    const plan = await service.planBuild();

    expect(plan.templates[0].batches).toHaveLength(1);
    expect(plan.templates[0].batches[0].slotIds).toHaveLength(6);
  });

  it('splits incomplete JSON batch responses and retries smaller batches', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-incomplete-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '# Brief',
        '',
        '[[INSTRUCTION: Fill first.]]',
        '',
        '[[INSTRUCTION: Fill second.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.build.slotBatchSize = 2;
    const workspace = new WorkspaceService(config);
    const llm = new IncompleteBatchLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.completeJsonCalls).toBe(3);
    const output = await workspace.readTextFile(
      path.join(root, 'deliverables', 'brief.md'),
    );
    expect(output).toContain('Rendered instruction-1.');
    expect(output).toContain('Rendered instruction-2.');
  });

  it('limits concurrent build batch LLM calls', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-build-concurrency-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'templates'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });

    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    await writeFile(
      path.join(root, 'templates', 'brief.md'),
      [
        '# Brief',
        '',
        '[[INSTRUCTION: Fill first.]]',
        '',
        '[[INSTRUCTION: Fill second.]]',
        '',
        '[[INSTRUCTION: Fill third.]]',
        '',
        '[[INSTRUCTION: Fill fourth.]]',
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(root);
    config.build.slotBatchSize = 1;
    config.limits.maxInFlightRequests = 2;
    const workspace = new WorkspaceService(config);
    const llm = new ConcurrentBuildLLMService();
    const service = new BuildService(
      config,
      workspace,
      llm as unknown as LLMService,
      new FakeRetrievalService() as unknown as RetrievalService,
    );

    await service.build();

    expect(llm.completeJsonCalls).toBe(4);
    expect(llm.maxActive).toBeLessThanOrEqual(2);
    expect(llm.maxActive).toBeGreaterThan(1);
  });
});
