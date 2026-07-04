#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { Console } from 'node:console';

const ROOT = new URL('..', import.meta.url).pathname;
const logger = new Console(process.stdout, process.stderr);
const MAX_LINES = 800;
const LEGACY_LIMITS = new Map([
  ['src/commands/serve.ts', 4330],
  ['src/chat/chatHtml.ts', 2400],
  ['src/chat/styles/chatStyles.ts', 550],
]);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (path.endsWith('.ts')) entries.push(path);
  }
  return entries;
}

const files = [
  join(ROOT, 'src', 'commands', 'serve.ts'),
  join(ROOT, 'src', 'chat', 'chatHtml.ts'),
  ...walk(join(ROOT, 'src', 'serve')),
  ...walk(join(ROOT, 'src', 'graph')),
  ...walk(join(ROOT, 'src', 'chat')).filter((file) => !file.endsWith('/chatHtml.ts')),
];

const failures = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const limit = LEGACY_LIMITS.get(rel) ?? MAX_LINES;
  const lines = readFileSync(file, 'utf8').split('\n').length;
  const ok = lines <= limit;
  logger.log(`${ok ? 'ok' : 'FAIL'} ${rel}: ${lines}/${limit}`);
  if (!ok) failures.push({ rel, lines, limit });
}

if (failures.length) {
  logger.error('\nFile size check failed.');
  process.exit(1);
}
