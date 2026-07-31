#!/usr/bin/env node
declare const __PKG_VERSION__: string;
import { readFileSync } from 'node:fs';
import { Command, Option } from 'commander';
import { loadConfig, findWikircPath } from '../src/config/loadConfig.ts';
import { loadWorkspaceEnv } from '../src/config/loadEnv.ts';
import {
  isLegacyProviderError,
  migrateLegacyConfigFile,
} from '../src/config/migrateLegacyConfig.ts';
import initCmd from '../src/commands/init.ts';
import ingestCmd from '../src/commands/ingest.ts';
import queryCmd from '../src/commands/query.ts';
import lintCmd from '../src/commands/lint.ts';
import buildCmd from '../src/commands/build.ts';
import indexCmd from '../src/commands/index.ts';
import groupConceptsCmd from '../src/commands/groupConcepts.ts';
import refreshCmd from '../src/commands/refresh.ts';
import serveCmd from '../src/commands/serve.ts';
import doctorCmd from '../src/commands/doctor.ts';
import mcpCmd from '../src/commands/mcp.ts';
import mcpHttpCmd from '../src/commands/mcpHttp.ts';
import exportCmd from '../src/commands/export.ts';
import addSkillCmd from '../src/commands/addSkill.ts';
import configCmd from '../src/commands/config.ts';

const program = new Command();
const packageVersion = (() => {
  if (typeof __PKG_VERSION__ !== 'undefined') {
    return __PKG_VERSION__;
  }

  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw).version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
})();

function workspaceFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' || arg === '-w') {
      return argv[i + 1];
    }
    if (arg.startsWith('--workspace=')) {
      return arg.slice('--workspace='.length);
    }
  }
  return undefined;
}

/** Options globales qui consomment la valeur suivante dans argv. */
const VALUE_TAKING_FLAGS = new Set(['-w', '--workspace']);

/** Première sous-commande réelle, options et valeurs d'options écartées. */
function subcommandOf(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (VALUE_TAKING_FLAGS.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    return token;
  }
  return undefined;
}

/**
 * `llm.provider` a été scindé en `provider` + `engine` en 0.16, et
 * `resolveConfig` rejette désormais l'ancien format. Le rejet survient avant
 * que la moindre commande soit construite : `wiki doctor --apply` ne peut donc
 * pas migrer un fichier qu'il n'arrive pas à charger.
 *
 * On intercepte ici, et uniquement pour `doctor --apply` — la commande que le
 * message d'erreur désigne, et la seule qui a mandat pour réécrire le wikirc.
 * Toute autre commande relaie l'erreur telle quelle : la migration reste un
 * geste explicite de l'utilisateur.
 */
async function loadConfigWithMigration(cwd: string) {
  try {
    return await loadConfig(cwd);
  } catch (error) {
    if (!isLegacyProviderError(error)) throw error;

    // `argv.includes('doctor')` ne suffit pas : `--apply` existe aussi sur
    // `group-concepts`, et « doctor » peut apparaître comme valeur d'option
    // (un workspace nommé ainsi, par exemple). On identifie donc la
    // sous-commande réelle en écartant les options et leurs valeurs.
    const argv = process.argv.slice(2);
    if (subcommandOf(argv) !== 'doctor' || !argv.includes('--apply')) throw error;

    const configPath = await findWikircPath(cwd);
    if (!configPath) throw error;

    const migration = await migrateLegacyConfigFile(
      configPath,
      readFileSync(configPath, 'utf8'),
    );
    if (!migration) throw error;

    console.log(
      `Migrated ${configPath}: llm.provider "${migration.from}" → provider: ${migration.to.provider} / engine: ${migration.to.engine}.`,
    );
    if (migration.materializedBaseUrl) {
      console.log(
        `  llm.baseUrl was implicit and is now written explicitly: ${migration.materializedBaseUrl}`,
      );
    }
    return await loadConfig(cwd);
  }
}

async function main() {
  const workspaceArg = workspaceFromArgv(process.argv.slice(2));
  if (workspaceArg) {
    process.env.WIKI_WORKSPACE = workspaceArg;
  }
  await loadWorkspaceEnv(process.cwd());
  const config = await loadConfigWithMigration(process.cwd());

  program
    .name('wiki')
    .description('Local-first LLM wiki CLI')
    .version(packageVersion)
    .option('-w, --workspace <path>', 'Workspace root containing .wikirc.yaml');

  program
    .command('config')
    .description('Inspect the effective .wikirc.yaml configuration')
    .option(
      '--effective',
      'Print the merged configuration with defaults, preset values, and file overrides',
    )
    .option('--json', 'Emit JSON including provenance')
    .action((options) => configCmd(options));

  program
    .command('init')
    .description('Initialize a local wiki workspace')
    .option('-f, --force', 'Force overwrite existing directories')
    .action((options) => initCmd(config, options));

  program
    .command('add-skill')
    .description(
      'Install a workspace method from a directory, .zip file, or HTTP(S) .zip URL',
    )
    .argument('<source>', 'Skill directory, .zip file, or HTTP(S) .zip URL')
    .action((source) => addSkillCmd(config, source));

  program
    .command('ingest')
    .description('Ingest markdown sources from raw/untracked into the persistent wiki')
    .argument(
      '[files...]',
      'Specific files relative to the workspace root or raw/untracked',
    )
    .option('--dry-run', 'Show planned wiki operations without writing')
    .addOption(
      new Option(
        '--plan-only',
        'Write planned ingest operations without applying them',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--apply <file...>',
        'Apply planned ingest operation file(s)',
      ).hideHelp(),
    )
    .option('--refresh', 'Run deliverable rebuild after ingest')
    .option('--force', 'Re-ingest even if the source is unchanged since last ingest')
    .option('--reject <path...>', 'Reject planned wiki operation path(s) during review')
    .option('-v, --verbose', 'Print ingestion step traces')
    .option('--debug', 'Print detailed ingestion traces')
    .option(
      '--trace-file <path>',
      'Write traces to a specific file relative to the workspace root',
    )
    .action((files, options) => ingestCmd(config, files, options));

  program
    .command('query')
    .description('Query the wiki and its cited source notes')
    .argument('<question...>', 'Question to answer from the wiki')
    .option('--save', 'Save the answer to wiki/answers/')
    .action((questionParts, options) =>
      queryCmd(config, questionParts.join(' '), options),
    );

  program
    .command('index')
    .description('Create or update the local vector index for wiki markdown pages')
    .action(() => indexCmd(config));

  program
    .command('group-concepts')
    .description(
      'Plan or apply grouping of flat wiki/concepts pages using frontmatter group',
    )
    .option('--apply', 'Move grouped concept files and update wiki links')
    .action((options) => groupConceptsCmd(config, options));

  program
    .command('lint')
    .description('Run static checks and optional semantic analysis on the wiki')
    .option('--with-llm', 'Run semantic linting through the configured LLM')
    .option('--json', 'Emit lint results as JSON')
    .action((options) => lintCmd(config, options));

  program
    .command('build')
    .description(
      'Generate deliverables from markdown templates with [[INSTRUCTION: ...]] slots',
    )
    .argument('[templates...]', 'Specific template files to build')
    .option('--force', 'Rebuild even if the template is already up to date')
    .option(
      '--stabilize',
      'Preserve unchanged existing deliverable sections while applying changed sections',
    )
    .option(
      '--plan',
      'Plan batches and estimated input tokens without calling the generation LLM',
    )
    .option('-v, --verbose', 'Print build step traces')
    .option('--debug', 'Print detailed build traces')
    .option(
      '--trace-file <path>',
      'Write traces to a specific file relative to the workspace root',
    )
    .action((templates, options) => buildCmd(config, templates, options));

  program
    .command('refresh')
    .description('Regenerate only stale deliverables when the wiki or templates changed')
    .argument('[templates...]', 'Specific template files to refresh')
    .option('--force', 'Refresh all selected deliverables')
    .option('-v, --verbose', 'Print build step traces')
    .option('--debug', 'Print detailed build traces')
    .option(
      '--trace-file <path>',
      'Write traces to a specific file relative to the workspace root',
    )
    .action((templates, options) => refreshCmd(config, templates, options));

  program
    .command('serve')
    .description('Start a local HTTP server to browse the wiki in a browser')
    .option('-p, --port <number>', 'Port to listen on', '3000')
    .option(
      '--open',
      'Open the wiki in app mode (Chrome/Edge --app flag, or Safari/default browser)',
    )
    .action((options) =>
      serveCmd(config, { port: parseInt(options.port, 10), open: Boolean(options.open) }),
    );

  program
    .command('doctor')
    .description(
      'Check .wikirc.yaml, test provider connectivity, and recommend optimal settings',
    )
    .option('--apply', 'Apply the recommended .wikirc.yaml values')
    .action((options) => doctorCmd(config, options));

  program
    .command('mcp')
    .description('Start an MCP stdio server exposing the wiki workspace to AI assistants')
    .action(() => mcpCmd(config));

  program
    .command('mcp-http')
    .description('Start an MCP Streamable HTTP server exposing the wiki workspace')
    .option('--host <host>', 'Host to listen on', '127.0.0.1')
    .option('-p, --port <number>', 'Port to listen on', '3333')
    .option('--path <path>', 'HTTP endpoint path', '/mcp')
    .action((options) =>
      mcpHttpCmd(config, {
        host: options.host,
        port: parseInt(options.port, 10),
        path: options.path,
      }),
    );

  program
    .command('export')
    .description(
      'Expand a deliverable into a self-contained document with inline source details',
    )
    .argument(
      '<deliverable>',
      'Path to the deliverable to expand (relative to workspace root or deliverables/)',
    )
    .option(
      '--output <path>',
      'Output path relative to workspace root (default: <name>.export.md)',
    )
    .option('--polish', 'Run an editorial polish pass after expansion')
    .option('-v, --verbose', 'Print export step traces')
    .option('--debug', 'Print detailed traces')
    .option('--trace-file <path>', 'Write traces to a specific file')
    .action((deliverable, opts) => exportCmd(config, deliverable, opts));

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
