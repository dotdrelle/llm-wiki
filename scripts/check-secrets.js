#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Console } from 'node:console';

const logger = new Console(process.stdout, process.stderr);

const trackedFiles = execFileSync('git', ['ls-files'], {
  encoding: 'utf8',
})
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !file.startsWith('dist/'))
  .filter((file) => !file.startsWith('node_modules/'));

const assignmentPattern =
  /\b(api[_-]?key|access[_-]?key|auth[_-]?token|token|secret|password)\b\s*[:=]\s*["']?([^"'\s#,}]{20,})/gi;
const knownSecretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
];
const placeholderPattern =
  /^(YOUR_|MON_|INFINITY_|OPENAI_|ANTHROPIC_|NVIDIA_|VECTOR_|ALBERT_|WIKI_|OLLAMA_|test|generated|optional|example|dummy|placeholder|ollama)/i;

function isAllowedPlaceholder(value) {
  const normalized = value.replace(/^\$\{/, '').replace(/\}$/, '');
  return placeholderPattern.test(normalized) || /^[A-Z0-9_]+$/.test(normalized);
}

function shouldScanAssignments(file) {
  return (
    file.startsWith('scaffold/') ||
    file.endsWith('.env') ||
    file.endsWith('.env.example') ||
    file.endsWith('.yaml') ||
    file.endsWith('.yml') ||
    file.endsWith('.json')
  );
}

const findings = [];

for (const file of trackedFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(#|\/\/|\*)/.test(line)) return;
    if (shouldScanAssignments(file)) {
      assignmentPattern.lastIndex = 0;
      for (const match of line.matchAll(assignmentPattern)) {
        const value = match[2] ?? '';
        if (!isAllowedPlaceholder(value)) {
          findings.push(`${file}:${index + 1}: possible inline secret for ${match[1]}`);
        }
      }
    }
    for (const pattern of knownSecretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push(`${file}:${index + 1}: possible provider token`);
      }
    }
  });
}

const scaffold = readFileSync('scaffold/workspace/.wikirc.yaml', 'utf8');
const activeSecretLines = scaffold
  .split('\n')
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => !/^\s*#/.test(line))
  .filter(({ line }) => /^\s*(apiKey|accessKey):\s*\S+/.test(line))
  .filter(({ line }) => !/^\s*apiKey:\s*\$\{[A-Z0-9_]+\}\s*$/.test(line));

for (const finding of activeSecretLines) {
  findings.push(
    `scaffold/workspace/.wikirc.yaml:${finding.index}: active inline scaffold secret`,
  );
}

if (findings.length > 0) {
  logger.error('Secret scan failed:');
  for (const finding of findings) logger.error(`  ${finding}`);
  process.exit(1);
}

logger.log('Secret scan passed.');
