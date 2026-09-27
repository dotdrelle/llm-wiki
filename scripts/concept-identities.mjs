#!/usr/bin/env node
/*
 * Backfill concept and subject IDs on a workspace copy. Preview is the default;
 * --apply writes only frontmatter identity fields and never moves or merges pages.
 *
 * Usage:
 *   pnpm concepts:identities /path/to/workspace-copy
 *   pnpm concepts:identities /path/to/workspace-copy --apply
 */
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = args.find((value) => !value.startsWith('--'));
if (!root) {
  process.stderr.write('usage: concepts:identities <workspace-root> [--apply]\n');
  process.exit(2);
}

const { migrateConceptIdentities } = await import('../src/ingest/identityMigration.ts');
const report = await migrateConceptIdentities({ rootDir: path.resolve(root), apply });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
