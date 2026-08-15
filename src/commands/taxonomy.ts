import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { synthesizeTaxonomy } from '../graph/wiki/taxonomy/run.ts';
import { taxonomyProposalSchema } from '../graph/wiki/taxonomy/synthesize.ts';

/**
 * `wiki taxonomy` — bounded synthesis of the graph taxonomy.
 *
 * A command **bounded** in the plan's sense: a condensed inventory, a fixed
 * number of attempts, block validation, an atomic write. It never touches the
 * wiki content — the taxonomy is a derived projection, not a rewrite of the
 * pages.
 *
 * It is the only place where an LLM enters the graph path. Neither `serve`,
 * nor `wiki_outline`, nor the snapshot can trigger one: they read the registry
 * this command wrote.
 */
export default async function taxonomyCmd(
  config: AppConfig,
  options: { apply?: boolean; force?: boolean; maxPages?: string },
) {
  const workspace = new WorkspaceService(config);
  await workspace.ensureInitialized();
  const rootDir = workspace.paths.rootDir;
  const language = config.language ?? 'en';

  const llm = new LLMService(config);
  const propose = async (request: { system: string; user: string }) =>
    llm.completeJson(
      { ...request, jsonMode: true, label: 'taxonomy-synthesis', temperature: 0 },
      taxonomyProposalSchema,
    );

  if (!options.apply) {
    // Without --apply, we do not consult the model: showing what would be sent
    // costs zero tokens and is enough to judge the inventory.
    const { loadWikiGraphSnapshot } = await import('../graph/wiki/overview.ts');
    const { buildTaxonomyInventory } = await import('../graph/wiki/taxonomy/inventory.ts');
    const { buildSynthesisPrompt } = await import('../graph/wiki/taxonomy/synthesize.ts');
    const snapshot = await loadWikiGraphSnapshot({ rootDir, language });
    const inventory = buildTaxonomyInventory(snapshot, { language });
    console.log(buildSynthesisPrompt(inventory));
    console.log(
      `\nDry run: ${inventory.pageCount} page(s), ${inventory.communities.length} existing community/ies`
      + `${inventory.truncated ? ' (corpus truncated)' : ''}.`,
    );
    console.log('Re-run with --apply to synthesize and publish a taxonomy revision.');
    return;
  }

  const outcome = await synthesizeTaxonomy(
    rootDir,
    { language, force: options.force === true },
    {
      propose,
      ...(options.maxPages ? { maxPages: Number(options.maxPages) } : {}),
    },
  );

  switch (outcome.status) {
    case 'published':
      // "N communities" counted the domains: a reader thought the map was flat
      // and could not see that 15 subjects lived underneath.
      console.log(
        `Taxonomy revision ${outcome.revision} published: ${outcome.communities} domain(s)`
        + ` and ${outcome.leaves} leaf community/ies over ${outcome.inventory.pageCount} page(s),`
        + ` language ${language}.`,
      );
      if (outcome.warnings.length) {
        // Published anyway: the user sees the map AND what is off, instead of a
        // refusal that shows nothing.
        console.log(`\n${outcome.warnings.length} reservation(s) on this taxonomy:`);
        for (const warning of outcome.warnings.slice(0, 20)) console.log(`  - ${warning}`);
      }
      return;
    case 'unchanged':
      console.log(`Taxonomy unchanged at revision ${outcome.revision}.`);
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
    case 'deferred':
      console.log(
        outcome.reason
          ? `Synthesis failed before publishing: ${outcome.reason}. Previous registry kept, retry pending.`
          : 'Could not publish the revision: previous registry kept, retry pending.',
      );
      process.exitCode = 1;
      return;
    default:
      console.log('Taxonomy proposal rejected:');
      for (const issue of outcome.issues.slice(0, 20)) console.log(`  - ${issue}`);
      process.exitCode = 1;
  }
}
