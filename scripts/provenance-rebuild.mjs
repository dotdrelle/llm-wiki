#!/usr/bin/env node
/*
 * Lot 6 (deterministic half): rebuild the `sources:` inventory of a workspace
 * copy from each page's body closure. Dry-run by default; pass --apply to
 * write. No LLM, no re-synthesis.
 *
 * Usage:
 *   pnpm rebuild:provenance /path/to/workspace-copy            # dry-run
 *   pnpm rebuild:provenance /path/to/workspace-copy --apply
 */
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = args.find((value) => !value.startsWith('--'));
if (!root) {
  process.stderr.write('usage: provenance-rebuild <workspace-root> [--apply]\n');
  process.exit(2);
}

const { rebuildProvenance } = await import('../src/provenance/rebuild.ts');
const report = await rebuildProvenance({ rootDir: path.resolve(root), apply });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
