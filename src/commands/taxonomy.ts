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
import {
  buildDomainSystemPrompt,
  buildDomainUserPrompt,
  domainProposalSchema,
} from '../graph/wiki/taxonomy/derived.ts';
import { knowledgeEtag, listKnowledgeFiles } from '../graph/wiki/taxonomy/knowledge.ts';
import { readConceptGrid } from '../ingest/conceptGrid.ts';

/**
 * `wiki taxonomy` — prompt-driven synthesis of the graph taxonomy.
 *
 * One clean prompt, one model call, coverage and label validation, then an
 * atomic write. It never touches the wiki content — the taxonomy is a derived
 * projection, not a rewrite of the pages.
 *
 * `serve`'s `/graph` "Build" button used to run this synthesis directly
 * (`graphTaxonomyRun.ts` → `POST /api/graph/taxonomy`), bypassing Donna and
 * the runtime's approval/idempotency-key machinery. It now posts a
 * `/wiki-taxonomy` skill invocation to Donna instead (wikiPanelScript.ts) —
 * the same production-pipeline `taxonomy` step this command's `--apply`
 * wraps. `wiki_outline` and the snapshot only read the registry this command
 * (or that skill) publishes.
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
  // The derived path (a workspace with a concept grid) asks the model a
  // different question and a different shape: `{domains, classDomains}`.
  const proposeJson = async (request: { system: string; user: string }) =>
    llm.completeJson(
      {
        ...request,
        jsonMode: true,
        jsonExtraction: 'trailing',
        label: 'taxonomy-synthesis',
        temperature: 0,
      },
      domainProposalSchema,
    );

  if (!options.apply) {
    // Dry run: show the exact prompts --apply would send, without a model call.
    // Mirrors synthesizeSimpleTaxonomy's own fork: a workspace with a published
    // concept grid takes the derived (class-gathering) path, not the legacy one.
    const files = await listKnowledgeFiles(rootDir);
    const pages = await readPageBriefs(rootDir, files);
    const gridRead = await readConceptGrid(rootDir);
    if (gridRead.status === 'malformed') {
      console.log('Concept grid is malformed:');
      for (const issue of gridRead.issues.slice(0, 20)) console.log(`  - ${issue}`);
      process.exitCode = 1;
      return;
    }
    if (gridRead.status === 'ok') {
      const { grid } = gridRead;
      const pageCountByClass = new Map<string, number>();
      for (const page of pages) {
        if (page.class && grid.set.has(page.class)) {
          pageCountByClass.set(page.class, (pageCountByClass.get(page.class) ?? 0) + 1);
        }
      }
      console.log(buildDomainSystemPrompt(language));
      console.log('\n--- user ---\n');
      console.log(buildDomainUserPrompt(grid, pageCountByClass, language));
      console.log(
        `\nDry run: ${pages.length} page(s) over ${grid.classes.length} class(es).`
        + ' Re-run with --apply to synthesize and publish a taxonomy revision.',
      );
      return;
    }
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
    { propose, proposeJson, ...(options.expectedCorpus ? { expectedCorpus: options.expectedCorpus } : {}) },
  );

  switch (outcome.status) {
    case 'published':
      console.log(
        `Taxonomy revision ${outcome.revision} published: ${outcome.domains} domain(s)`
        + ` and ${outcome.leaves} leaf communit(y/ies) over ${outcome.pageCount} page(s), language ${language}.`,
      );
      // Computed but silently dropped before this: a published taxonomy read
      // exactly the same whether it used the grid or fell back to legacy
      // per-identity clustering, or gathered pages under `unclassified` for
      // lack of a class. This is the only place these reach the operator.
      for (const warning of outcome.warnings) console.log(`  warning: ${warning}`);
      await workspace.appendLog(
        'taxonomy',
        `Revision ${outcome.revision} published: ${outcome.domains} domain(s) and ${outcome.leaves}`
        + ` leaf communit(y/ies) over ${outcome.pageCount} page(s), language ${language}.`
        + (outcome.warnings.length ? ` Warnings: ${outcome.warnings.join(' | ')}` : ''),
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
