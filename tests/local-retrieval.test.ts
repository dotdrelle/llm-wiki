import { access } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loadConfig.ts';
import { EmbeddingService } from '../src/services/embeddingService.ts';
import { RerankService } from '../src/services/rerankService.ts';
import { RetrievalService } from '../src/services/retrievalService.ts';
import { VectorIndexService } from '../src/services/vectorIndexService.ts';
import { WorkspaceService } from '../src/services/workspaceService.ts';

const LOCAL_WIKI_ROOT =
  process.env.LLM_WIKI_LOCAL_ROOT ?? '/path/to/local/wiki-workspace';
const RUN_LOCAL_RETRIEVAL = process.env.LLM_WIKI_LOCAL_RETRIEVAL === '1';
const LOCAL_RETRIEVAL_CASES_JSON = process.env.LLM_WIKI_LOCAL_RETRIEVAL_CASES;

interface RetrievalCase {
  question: string;
  expectedAnyTop10: string[];
}

const retrievalCases: RetrievalCase[] = LOCAL_RETRIEVAL_CASES_JSON
  ? (JSON.parse(LOCAL_RETRIEVAL_CASES_JSON) as RetrievalCase[])
  : [];

class EmptyRerankService {
  async rerank() {
    return [];
  }
}

function formatPaths(paths: string[]): string {
  return paths.map((p, i) => `${i + 1}. ${p}`).join('\n');
}

describe.skipIf(!RUN_LOCAL_RETRIEVAL || retrievalCases.length === 0)(
  'local wiki retrieval quality',
  () => {
    beforeAll(async () => {
      await access(path.join(LOCAL_WIKI_ROOT, '.wikirc.yaml'));
      await access(path.join(LOCAL_WIKI_ROOT, '.wiki', 'vector-index'));
    });

    it.each(retrievalCases)(
      'retrieves expected wiki pages for "$question"',
      async ({ question, expectedAnyTop10 }) => {
        const config = await loadConfig(LOCAL_WIKI_ROOT);
        config.retrieval.vector.enabled = true;
        const workspace = new WorkspaceService(config);
        const retrieval = new RetrievalService(workspace, config);
        const vectorIndex = new VectorIndexService(
          config,
          workspace,
          new EmbeddingService(config),
          new RerankService(config),
        );
        const vectorOnlyIndex = new VectorIndexService(
          config,
          workspace,
          new EmbeddingService(config),
          new EmptyRerankService() as unknown as RerankService,
        );

        const results = await retrieval.search(question, {
          limit: 10,
          includeRaw: false,
        });
        const paths = results.map((result) => result.page.relativePath);
        const vectorOnlyResults = await vectorOnlyIndex.search(question, { limit: 30 });
        const vectorOnlyPaths = vectorOnlyResults.map(
          (result) => result.page.relativePath,
        );
        const stats = await vectorIndex.stats();
        const expectedInVectorOnly = vectorOnlyPaths.some((resultPath) =>
          expectedAnyTop10.includes(resultPath),
        );

        expect(
          paths.some((resultPath) => expectedAnyTop10.includes(resultPath)),
          [
            `Retrieval failed for "${question}"`,
            '',
            `Expected any of:`,
            formatPaths(expectedAnyTop10),
            '',
            `Index: ${stats.exists ? `${stats.rows} chunk(s)` : 'missing'} at ${stats.path}`,
            `Expected present in vector-only top 30: ${expectedInVectorOnly}`,
            '',
            'Final top 10:',
            formatPaths(paths),
            '',
            'Vector-only top 30:',
            formatPaths(vectorOnlyPaths),
          ].join('\n'),
        ).toBe(true);
      },
      60_000,
    );
  },
);
