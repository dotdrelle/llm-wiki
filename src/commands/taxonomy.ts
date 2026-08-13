import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { synthesizeTaxonomy } from '../graph/wiki/taxonomy/run.ts';
import { taxonomyProposalSchema } from '../graph/wiki/taxonomy/synthesize.ts';

/**
 * `wiki taxonomy` — synthèse bornée de la taxonomie du graphe.
 *
 * Commande **bornée** au sens du plan : un inventaire condensé, un nombre
 * d'essais fixé, une validation en bloc, une écriture atomique. Elle ne touche
 * jamais au contenu du wiki — la taxonomie est une projection dérivée, pas une
 * réécriture des pages.
 *
 * Elle est le seul endroit où un LLM entre dans le chemin du graphe. Ni
 * `serve`, ni `wiki_outline`, ni le snapshot ne peuvent en déclencher un : ils
 * lisent le registre que cette commande a écrit.
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
    // Sans --apply, on ne consulte pas le modèle : montrer ce qui serait envoyé
    // coûte zéro token et suffit à juger l'inventaire.
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
      // « N communities » comptait les domaines : un lecteur croyait la carte
      // plate et ne pouvait pas voir que 15 sujets vivaient en dessous.
      console.log(
        `Taxonomy revision ${outcome.revision} published: ${outcome.communities} domain(s)`
        + ` and ${outcome.leaves} leaf community/ies over ${outcome.inventory.pageCount} page(s),`
        + ` language ${language}.`,
      );
      if (outcome.warnings.length) {
        // Publié malgré tout : l'utilisateur voit la carte ET ce qui cloche,
        // au lieu d'un refus qui ne montre rien.
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
