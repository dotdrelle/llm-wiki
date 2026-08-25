import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { CONCEPT_GRID_RELATIVE_PATH } from '../ingest/conceptGrid.ts';
import {
  buildGridSystemPrompt,
  buildGridUserPrompt,
  conceptGridProposalSchema,
  listRawDocuments,
  readDocumentBriefs,
  synthesizeConceptGrid,
} from '../ingest/conceptGridSynthesis.ts';
import { regenerateWikiIndex } from '../services/wikiIndexService.ts';
import { publishCorpusRevision } from '../graph/wiki/taxonomy/publish.ts';

/**
 * `wiki concepts` — synthesize the workspace's conceptual grid.
 *
 * The one pass that looks at the whole corpus at once. It writes
 * `wiki/concepts-grid.md` and nothing else: no page is created, moved or
 * rewritten here. The grid is then consumed by the ingest, which files into it
 * and refuses what it cannot file.
 *
 * Run rarely and deliberately. Re-ingesting a document must NOT rebuild the
 * grid — a filing plan that moves under every new document is not a filing
 * plan. That is also why removing a class is reported loudly: every page filed
 * under it becomes unfilable at the next ingest.
 *
 * `llm.conceptsModel` overrides `llm.model` for this command only. The grid is
 * a small, rare, reviewable artefact and it is the one open-ended synthesis of
 * the chain, so it is the right place — and the only place — to spend a
 * stronger model than the one doing the per-document work.
 */
export default async function conceptsCmd(
  config: AppConfig,
  options: { apply?: boolean },
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const rootDir = workspace.paths.rootDir;
  const language = config.language ?? 'en';

  if (!options.apply) {
    const files = await listRawDocuments(rootDir);
    const documents = await readDocumentBriefs(rootDir, files);
    console.log(buildGridSystemPrompt(documents.length, language));
    console.log('\n--- user ---\n');
    console.log(buildGridUserPrompt(documents));
    console.log(
      `\nDry run: ${documents.length} raw document(s).`
      + ` Re-run with --apply to synthesize and write ${CONCEPT_GRID_RELATIVE_PATH}.`,
    );
    return;
  }

  const conceptsConfig = config.llm.conceptsModel
    ? { ...config, llm: { ...config.llm, model: config.llm.conceptsModel } }
    : config;
  const llm = new LLMService(conceptsConfig);
  const propose = async (request: { system: string; user: string }) =>
    llm.completeJson(
      {
        ...request,
        jsonMode: true,
        // Same reason as the taxonomy synthesis: `json_object` is not sent to
        // every engine and a reasoning model narrates anyway, so read the LAST
        // balanced JSON object rather than the first.
        jsonExtraction: 'trailing',
        label: 'concept-grid',
        temperature: 0,
      },
      conceptGridProposalSchema,
    );

  const outcome = await synthesizeConceptGrid(rootDir, { language }, { propose });

  switch (outcome.status) {
    case 'written': {
      console.log(
        `${CONCEPT_GRID_RELATIVE_PATH} written: ${outcome.classes} class(es)`
        + ` over ${outcome.documents} document(s), language ${language}.`,
      );
      if (outcome.added.length) console.log(`  added: ${outcome.added.join(', ')}`);
      if (outcome.removed.length) {
        // Not cosmetic: a page filed under a class that no longer exists is
        // rejected at the next ingest, and nothing else in the chain will say
        // why.
        console.log(`  REMOVED: ${outcome.removed.join(', ')}`);
        console.log('  Pages filed under a removed class must be re-filed before the next ingest.');
      }
      for (const warning of outcome.warnings) console.log(`  reservation: ${warning}`);
      // The grid itself sits outside wiki/concepts/** and wiki/sources/*, so
      // it never changes what regenerateWikiIndex lists — but keep the same
      // call site as concepts/taxonomy so the index self-heals from any
      // drift left by an older run, at negligible cost. wiki/index.md is
      // itself part of the knowledge corpus, so republish AFTER writing it —
      // publishing first would freeze a corpus the rewrite immediately
      // invalidates again.
      const indexOutcome = await regenerateWikiIndex(rootDir);
      if (indexOutcome.status === 'failed') {
        console.log(`  warning: wiki/index.md was not regenerated: ${String(indexOutcome.error)}`);
      }
      await publishCorpusRevision(rootDir);
      await workspace.appendLog(
        'concepts',
        `${CONCEPT_GRID_RELATIVE_PATH} written: ${outcome.classes} class(es) over ${outcome.documents} document(s).`
        + (outcome.added.length ? ` Added: ${outcome.added.join(', ')}.` : '')
        + (outcome.removed.length ? ` REMOVED: ${outcome.removed.join(', ')}.` : ''),
      );
      return;
    }
    case 'skipped':
      console.log(
        outcome.reason === 'no_llm'
          ? 'No LLM configured: no grid synthesized.'
          : 'No raw document under raw/ingested: nothing to synthesize.',
      );
      return;
    default:
      console.log('Grid proposal rejected:');
      for (const issue of outcome.issues.slice(0, 20)) console.log(`  - ${issue}`);
      process.exitCode = 1;
  }
}
