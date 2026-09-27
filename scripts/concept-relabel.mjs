#!/usr/bin/env node
/*
 * Preview a workspace concept-label migration. The reviewed mapping is keyed by
 * concept_id; apply preserves identities and refuses collisions or merges.
 *
 * Usage:
 *   pnpm concepts:relabel /path/to/workspace-copy map.json
 *   pnpm concepts:relabel /path/to/workspace-copy map.json --apply
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const positional = args.filter((value) => !value.startsWith('--'));
const [root, mappingFile] = positional;
if (!root || !mappingFile) {
  process.stderr.write('usage: concepts:relabel <workspace-root> <mapping.json> [--apply]\n');
  process.exit(2);
}

const mapping = JSON.parse(await readFile(path.resolve(mappingFile), 'utf8'));
const { migrateConceptLabels } = await import('../src/ingest/conceptRelabelMigration.ts');
const report = await migrateConceptLabels({
  rootDir: path.resolve(root),
  mapping,
  apply,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
