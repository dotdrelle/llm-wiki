#!/usr/bin/env node
/*
 * Lot 0 of `plan-provenance-feuilles.md`: read-only provenance audit of a
 * workspace. It never writes and never calls the LLM.
 *
 * Usage:
 *   node --experimental-strip-types scripts/provenance-audit.mjs <workspace-root>
 *   pnpm audit:provenance /path/to/workspace          # or the package script
 */
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  process.stderr.write('usage: provenance-audit <workspace-root>\n');
  process.exit(2);
}

const { auditWorkspace } = await import('../src/provenance/audit.ts');
const report = await auditWorkspace({ rootDir: path.resolve(root) });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
