import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { synthesizeTaxonomy } from '../graph/wiki/taxonomy/run.ts';
import { taxonomyProposalSchema } from '../graph/wiki/taxonomy/synthesize.ts';
import { markdownPreview } from '../graph/wiki/projection.ts';
import { knowledgeEtag, listKnowledgeFiles } from '../graph/wiki/taxonomy/knowledge.ts';

/**
 * First lines of every knowledge page, as a plain excerpt.
 *
 * The snapshot carries no content by design (see the inventory's contract), so
 * the caller is the one that reads it. A title names the editorial form of a
 * document, not its subject; a short excerpt is what lets the model obey its
 * own "name what the pages are about" rule.
 *
 * The read is a bounded pool, like the graph projection: unbounded
 * `Promise.all` would open one `readFile` per page at once. The whole corpus is
 * read even though `maxPages` samples only a fraction — the sampling happens
 * inside `buildTaxonomyInventory`, so the caller cannot know it here. Accepted
 * short-term; a content cache like the knowledge-hash one would remove it.
 */
const EXCERPT_CONCURRENCY = 8;

async function readExcerpts(rootDir: string, files: string[]): Promise<Map<string, string>> {
  const excerpts = new Map<string, string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(EXCERPT_CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      if (!file) continue;
      try {
        excerpts.set(file, markdownPreview(await readFile(path.join(rootDir, file), 'utf8')));
      } catch {
        // A page that vanished between listing and reading carries no excerpt.
      }
    }
  }));
  return excerpts;
}

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
  options: { apply?: boolean; force?: boolean; maxPages?: string; expectedCorpus?: string; fingerprint?: boolean },
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

  const llm = new LLMService(config);
  const propose = async (request: { system: string; user: string }) =>
    llm.completeJson(
      { ...request, jsonMode: true, label: 'taxonomy-synthesis', temperature: 0 },
      taxonomyProposalSchema,
    );

  const excerpts = await readExcerpts(rootDir, await listKnowledgeFiles(rootDir));

  if (!options.apply) {
    // Without --apply, we do not consult the model: showing what would be sent
    // costs zero tokens and is enough to judge the inventory.
    const { loadWikiGraphSnapshot } = await import('../graph/wiki/overview.ts');
    const { buildTaxonomyInventory } = await import('../graph/wiki/taxonomy/inventory.ts');
    const { buildSynthesisPrompt } = await import('../graph/wiki/taxonomy/synthesize.ts');
    const { readActiveRegistry } = await import('../graph/wiki/taxonomy/store.ts');
    const { validateRegistry } = await import('../graph/wiki/taxonomy/schema.ts');
    const snapshot = await loadWikiGraphSnapshot({ rootDir, language });
    // The dry-run must show the prompt that --apply would send: the previous
    // registry is the source of the continuity section, never the deterministic
    // projection.
    const active = await readActiveRegistry(rootDir);
    const validated = active?.registry ? validateRegistry(active.registry) : null;
    const inventory = buildTaxonomyInventory(snapshot, {
      language,
      excerpts,
      registry: validated?.ok ? validated.registry : null,
    });
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
      excerpts,
      ...(options.maxPages ? { maxPages: Number(options.maxPages) } : {}),
      ...(options.expectedCorpus ? { expectedCorpus: options.expectedCorpus } : {}),
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
      /*
       Naming stability, measured rather than assumed.

       The hysteresis of `consolidate` is what decides whether a community keeps
       its name across revisions, and its two constants are only tunable against
       observed counts: a run full of `kept` means the model keeps proposing
       renames the engine refuses, a run full of `renamed` means the map moves
       under the reader. Printing the verdict is what turns those constants into
       a decision instead of a guess.
      */
      if (outcome.labelDecisions.length) {
        const counts = new Map<string, number>();
        for (const decision of outcome.labelDecisions) {
          counts.set(decision.outcome, (counts.get(decision.outcome) ?? 0) + 1);
        }
        const summary = ['unchanged', 'created', 'renamed', 'kept']
          .map((outcomeName) => `${counts.get(outcomeName) ?? 0} ${outcomeName}`)
          .join(', ');
        console.log(`\nLabels: ${summary}.`);
        // The refused renames are the only ones carrying an actionable number:
        // the overlap that fell short of the rename threshold.
        const kept = outcome.labelDecisions.filter((decision) => decision.outcome === 'kept');
        for (const decision of kept.slice(0, 20)) {
          const stability = decision.stability === undefined
            ? ''
            : ` (overlap ${decision.stability.toFixed(2)})`;
          console.log(`  - ${decision.label} kept over "${decision.proposed}"${stability}`);
        }
        if (kept.length > 20) console.log(`  … and ${kept.length - 20} more.`);
      }
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
