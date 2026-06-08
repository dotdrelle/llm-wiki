import type { AppConfig } from '../types.ts';
import { EmbeddingService } from '../services/embeddingService.ts';
import { RerankService } from '../services/rerankService.ts';
import { VectorIndexService } from '../services/vectorIndexService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { withSpinner } from '../utils/spinner.ts';

export default async function indexCmd(config: AppConfig): Promise<void> {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const service = new VectorIndexService(
    config,
    workspace,
    new EmbeddingService(config),
    new RerankService(config),
  );
  const result = await withSpinner('Indexing wiki vectors…', () => service.buildIndex());
  console.log(
    `Indexed ${result.indexedChunks} chunk(s) from ${result.indexedPages} wiki page(s).`,
  );
  console.log(
    `Embeddings: ${result.embeddedChunks} new/changed, ${result.reusedChunks} reused.`,
  );
  if (result.rebuiltForConfigChange) {
    console.warn(
      'Existing vector index was built with different embedding settings and was rebuilt.',
    );
  }
}
