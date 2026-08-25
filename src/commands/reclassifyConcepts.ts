import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import {
  buildReclassifySystemPrompt,
  buildReclassifyUserPrompt,
  listUnclassifiedPages,
  reclassifyConcepts,
  reclassifyProposalSchema,
} from '../services/conceptReclassifyService.ts';
import { readConceptGrid, UNCLASSIFIED_CLASS } from '../ingest/conceptGrid.ts';
import { publishCorpusRevision } from '../graph/wiki/taxonomy/publish.ts';
import { regenerateWikiIndex } from '../services/wikiIndexService.ts';

/**
 * `wiki reclassify-concepts` — files pages stuck under `wiki/concepts/unclassified/`
 * into the workspace's CURRENT grid.
 *
 * `wiki concepts --apply` only writes the grid; it never touches existing
 * pages. And re-ingesting a page's source is not a reliable fix once it
 * already produced an unclassified leaf: the consolidation prompt tells the
 * model to update an existing leaf at its EXISTING path, so a re-ingest can
 * just keep refreshing the unclassified copy instead of moving it. This
 * command is the deterministic alternative: one closed question per page
 * (which class of the grid, if any), then a mechanical move — no re-synthesis
 * of the leaf's own content.
 */
export default async function reclassifyConceptsCmd(
  config: AppConfig,
  options: { apply?: boolean },
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const rootDir = workspace.paths.rootDir;
  const language = config.language ?? 'en';

  if (!options.apply) {
    const gridRead = await readConceptGrid(rootDir);
    if (gridRead.status !== 'ok') {
      console.log(
        gridRead.status === 'absent'
          ? 'No concept grid yet: run `wiki concepts --apply` first.'
          : `Concept grid is malformed: ${gridRead.issues.join('; ')}`,
      );
      return;
    }
    const pages = await listUnclassifiedPages(workspace, gridRead.grid);
    if (!pages.length) {
      console.log(`No page under wiki/concepts/${UNCLASSIFIED_CLASS}/ and no page orphaned by a grid change: nothing to reclassify.`);
      return;
    }
    console.log(buildReclassifySystemPrompt(language));
    console.log('\n--- user ---\n');
    console.log(buildReclassifyUserPrompt(pages, gridRead.grid));
    console.log(
      `\nDry run: ${pages.length} page(s) need reclassification (unclassified or orphaned by a grid change).`
      + ' Re-run with --apply to call the LLM and move files.',
    );
    return;
  }

  const llm = new LLMService(config);
  const propose = async (request: { system: string; user: string }) =>
    llm.completeJson(
      {
        ...request,
        jsonMode: true,
        // Same reason as concepts/taxonomy: a reasoning model narrates
        // regardless of the instruction, so read the LAST balanced JSON
        // object rather than the first.
        jsonExtraction: 'trailing',
        label: 'concept-reclassify',
        temperature: 0,
      },
      reclassifyProposalSchema,
    );

  const outcome = await reclassifyConcepts(workspace, { language }, { propose });

  switch (outcome.status) {
    case 'reclassified': {
      const { moves, skipped } = outcome.plan;
      console.log(`Reclassified ${moves.length} page(s), ${skipped.length} left unclassified.`);
      for (const move of moves) console.log(`  ${move.path} -> ${move.to}`);
      for (const skip of skipped) console.log(`  ${skip.path}: ${skip.reason}`);
      // Moving pages under wiki/concepts/** advances the knowledge corpus
      // fingerprint without anything else re-syncing the taxonomy marker to
      // it. Left unpublished, the very next `wiki taxonomy --apply` in the
      // same pipeline chain computes a fresh --expected-corpus that can never
      // match the marker's now-stale one (nothing else moves it forward) —
      // a deterministic 'stale' abort on every attempt, not a transient race.
      if (moves.length > 0) {
        // Regenerate the index BEFORE publishing: wiki/index.md is itself part
        // of the knowledge corpus the fingerprint covers, so publishing first
        // would freeze a corpus that the index rewrite immediately invalidates
        // again, right back into the same stale-marker deadlock this fixes.
        const indexOutcome = await regenerateWikiIndex(rootDir);
        if (indexOutcome.status === 'failed') {
          console.log(`  warning: wiki/index.md was not regenerated: ${String(indexOutcome.error)}`);
        }
        await publishCorpusRevision(rootDir);
        await workspace.appendLog(
          'reclassify-concepts',
          `Reclassified ${moves.length} page(s): ${moves.map((move) => `${move.path} -> ${move.to}`).join('; ')}.`
          + (skipped.length ? ` ${skipped.length} left unclassified.` : ''),
        );
      }
      return;
    }
    case 'skipped':
      console.log(
        outcome.reason === 'no_llm'
          ? 'No LLM configured: nothing reclassified.'
          : outcome.reason === 'no_grid'
            ? 'No concept grid yet: run `wiki concepts --apply` first.'
            : `No page under wiki/concepts/${UNCLASSIFIED_CLASS}/ and no page orphaned by a grid change: nothing to reclassify.`,
      );
      return;
    default:
      console.log('Reclassify proposal rejected:');
      for (const issue of outcome.issues.slice(0, 20)) console.log(`  - ${issue}`);
      process.exitCode = 1;
  }
}
