import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import {
  buildSimplePrompt,
  buildSystemPrompt,
  readPageBriefs,
  simpleSynthesisSchema,
  synthesizeSimpleTaxonomy,
} from '../graph/wiki/taxonomy/simple.ts';
import { knowledgeEtag, listKnowledgeFiles } from '../graph/wiki/taxonomy/knowledge.ts';

/**
 * `wiki taxonomy` — prompt-driven synthesis of the graph taxonomy.
 *
 * One clean prompt, one model call, coverage and label validation, then an
 * atomic write. It never touches the wiki content — the taxonomy is a derived
 * projection, not a rewrite of the pages.
 *
 * Not the only place an LLM enters the graph path any more: `serve`'s `/graph`
 * "Rebuild" button also runs a synthesis, directly (`graphTaxonomyRun.ts` →
 * `POST /api/graph/taxonomy`), bypassing Donna/the runtime's approval and
 * idempotency-key machinery — see the finding tracked against that route.
 * `wiki_outline` and the snapshot still only read the registry this command
 * (or the Rebuild button) wrote.
 */
export default async function taxonomyCmd(
  config: AppConfig,
  options: { apply?: boolean; expectedCorpus?: string; fingerprint?: boolean },
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const rootDir = workspace.paths.rootDir;
  const language = config.language ?? 'en';

  if (options.fingerprint) {
    // Read-only: the frozen fingerprint the production barrier passes back as
    // `--expected-corpus`. No model call, no registry read beyond the marker.
    console.log(await knowledgeEtag(rootDir));
    return;
  }

  // The taxonomy synthesis can run on a different model than the agentic/ingest
  // work: `llm.taxonomyModel` overrides `llm.model` for this command only.
  const taxonomyConfig = config.llm.taxonomyModel
    ? { ...config, llm: { ...config.llm, model: config.llm.taxonomyModel } }
    : config;
  const llm = new LLMService(taxonomyConfig);
  const propose = async (request: { system: string; user: string }) =>
    llm.completeJson(
      {
        ...request,
        jsonMode: true,
        // The prompt asks for JSON only, but nothing enforces it on every
        // engine (see simple.ts's SYSTEM_TEMPLATE comment): read the last
        // balanced JSON object rather than the first, so a preamble a
        // reasoning model adds anyway does not get parsed instead of the
        // answer.
        jsonExtraction: 'trailing',
        label: 'taxonomy-synthesis',
        temperature: 0,
      },
      simpleSynthesisSchema,
    );

  if (!options.apply) {
    // Dry run: show the exact prompts --apply would send, without a model call.
    const files = await listKnowledgeFiles(rootDir);
    const pages = await readPageBriefs(rootDir, files);
    console.log(buildSystemPrompt(pages.length, language));
    console.log('\n--- user ---\n');
    console.log(buildSimplePrompt(pages, language));
    console.log(
      `\nDry run: ${pages.length} page(s). Re-run with --apply to synthesize and publish a taxonomy revision.`,
    );
    return;
  }

  const outcome = await synthesizeSimpleTaxonomy(
    rootDir,
    { language },
    { propose, ...(options.expectedCorpus ? { expectedCorpus: options.expectedCorpus } : {}) },
  );

  switch (outcome.status) {
    case 'published':
      console.log(
        `Taxonomy revision ${outcome.revision} published: ${outcome.domains} domain(s)`
        + ` and ${outcome.leaves} leaf communit(y/ies) over ${outcome.pageCount} page(s), language ${language}.`,
      );
      return;
    case 'skipped':
      console.log(
        outcome.reason === 'no_llm'
          ? 'No LLM configured: the graph keeps its deterministic projection.'
          : 'Empty corpus: nothing to synthesize.',
      );
      return;
    case 'stale':
      console.log('Corpus changed while synthesizing: proposal abandoned, previous registry kept.');
      process.exitCode = 1;
      return;
    default:
      console.log('Taxonomy proposal rejected:');
      for (const issue of outcome.issues.slice(0, 20)) console.log(`  - ${issue}`);
      process.exitCode = 1;
  }
}
