#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MAX_LINES = 500;
const LEGACY_LIMITS = new Map([
  ['src/commands/serve.ts', 5600],
  ['src/chat/chatHtml.ts', 4600],
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
  ...walk(join(ROOT, 'src', 'chat')).filter((file) => !file.endsWith('/chatHtml.ts')),
];

const failures = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const limit = LEGACY_LIMITS.get(rel) ?? MAX_LINES;
  const lines = readFileSync(file, 'utf8').split('\n').length;
  const ok = lines <= limit;
  console.log(`${ok ? 'ok' : 'FAIL'} ${rel}: ${lines}/${limit}`);
  if (!ok) failures.push({ rel, lines, limit });
}

if (failures.length) {
  console.error('\nFile size check failed.');
  process.exit(1);
}
