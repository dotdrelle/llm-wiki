#!/usr/bin/env node
declare const __PKG_VERSION__: string;
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from '../src/config/loadConfig.ts';
import initCmd from '../src/commands/init.ts';
import ingestCmd from '../src/commands/ingest.ts';
import queryCmd from '../src/commands/query.ts';
import lintCmd from '../src/commands/lint.ts';
import buildCmd from '../src/commands/build.ts';
import refreshCmd from '../src/commands/refresh.ts';
import serveCmd from '../src/commands/serve.ts';
import doctorCmd from '../src/commands/doctor.ts';

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

async function main() {
  const config = await loadConfig(process.cwd());

  program
    .name('wiki')
    .description('Local-first LLM wiki CLI')
    .version(packageVersion);

  program
    .command('init')
    .description('Initialize a local wiki workspace')
    .option('-f, --force', 'Force overwrite existing directories')
    .action((options) => initCmd(config, options));

  program
    .command('ingest')
    .description('Ingest markdown sources from raw/untracked into the persistent wiki')
    .argument('[files...]', 'Specific files relative to the workspace root or raw/untracked')
    .option('--dry-run', 'Show planned wiki operations without writing')
    .option('--[no-]refresh', 'Force or skip deliverable rebuild after ingest (default: follows refreshOnIngest in config)')
    .option('-v, --verbose', 'Print ingestion step traces')
    .option('--debug', 'Print detailed ingestion traces')
    .option('--trace-file <path>', 'Write traces to a specific file relative to the workspace root')
    .action((files, options) => ingestCmd(config, files, options));

  program
    .command('query')
    .description('Query the wiki and its cited source notes')
    .argument('<question...>', 'Question to answer from the wiki')
    .option('--save', 'Save the answer to wiki/answers/')
    .action((questionParts, options) => queryCmd(config, questionParts.join(' '), options));

  program
    .command('lint')
    .description('Run static checks and optional semantic analysis on the wiki')
    .option('--with-llm', 'Run semantic linting through the configured LLM')
    .option('--json', 'Emit lint results as JSON')
    .action((options) => lintCmd(config, options));

  program
    .command('build')
    .description('Generate deliverables from markdown templates with [[INSTRUCTION: ...]] slots')
    .argument('[templates...]', 'Specific template files to build')
    .option('--force', 'Rebuild even if the template is already up to date')
    .action((templates, options) => buildCmd(config, templates, options));

  program
    .command('refresh')
    .description('Regenerate only stale deliverables when the wiki or templates changed')
    .argument('[templates...]', 'Specific template files to refresh')
    .option('--force', 'Refresh all selected deliverables')
    .action((templates, options) => refreshCmd(config, templates, options));

  program
    .command('serve')
    .description('Start a local HTTP server to browse the wiki in a browser')
    .option('-p, --port <number>', 'Port to listen on', '3000')
    .action((options) => serveCmd(config, { port: parseInt(options.port, 10) }));

  program
    .command('doctor')
    .description('Check .wikirc.yaml, test provider connectivity, and recommend optimal settings')
    .action(() => doctorCmd(config));

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
