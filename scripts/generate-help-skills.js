#!/usr/bin/env node
// Renders the shipped scaffold skills into the product help.
//
// The skill list existed twice: once as the scaffold itself, once as prose in
// help-doc. Prose does not follow a scaffold — when the concepts rework added
// wiki-rebuild-concepts, wiki-reclassify and wiki-taxonomy, the help kept
// advertising the six skills it already knew, and a user reading it could not
// discover the three that mattered most to the new lifecycle.
//
// The scaffold directory is now the only source. This script regenerates the
// block between the markers in help-doc/08-commands-serve.md; the surrounding
// prose is authored by hand and never touched.
//
//   node scripts/generate-help-skills.js            # rewrite the block
//   node scripts/generate-help-skills.js --check    # fail if it has drifted
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { URL } from 'node:url';
import { Console } from 'node:console';

const ROOT = new URL('..', import.meta.url).pathname;
const SKILLS_DIR = join(ROOT, 'scaffold/workspace/.wiki/skills');
const HELP_FILE = join(ROOT, 'help-doc/08-commands-serve.md');
const BEGIN = '<!-- BEGIN GENERATED SKILLS -- run `npm run generate:help-skills`, do not edit by hand -->';
const END = '<!-- END GENERATED SKILLS -->';

const logger = new Console(process.stdout, process.stderr);

// Deliberately minimal: the front matter of a skill is a fixed, flat shape
// (name, description, execution, params). Parsing it here keeps this script
// dependency-free, and a malformed skill fails loudly rather than silently
// dropping out of the help.
export function readSkill(file) {
  const raw = readFileSync(join(SKILLS_DIR, file), 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`${file}: no front matter`);
  const meta = { params: [] };
  let inParams = false;
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed === 'params:') { inParams = true; continue; }
    if (trimmed === 'params: []') { inParams = false; continue; }
    if (inParams && trimmed.startsWith('- ')) { meta.params.push(trimmed.slice(2).trim()); continue; }
    inParams = false;
    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;
    meta[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
  }
  if (!meta.name) throw new Error(`${file}: front matter has no name`);
  if (!meta.description) throw new Error(`${file}: front matter has no description`);
  return meta;
}

export function renderSkillBlock() {
  const skills = readdirSync(SKILLS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map(readSkill);
  const lines = skills.map((skill) => {
    const args = skill.params.map((param) => ` [${param}]`).join('');
    // The description is the skill's own one-liner: the help and the catalog
    // the model selects from then say the same thing, by construction.
    return `- \`/${skill.name}${args}\` — ${lowerFirst(skill.description)}.`;
  });
  return [BEGIN, '', ...lines, '', END].join('\n');
}

function lowerFirst(text) {
  const value = String(text).trim().replace(/\.$/, '');
  // Only a plain capitalized first word is lowered; an acronym or a proper
  // noun ("DONNA", "Confluence") must survive untouched.
  return /^[A-Z][a-z]/.test(value) ? value[0].toLowerCase() + value.slice(1) : value;
}

// Importing this module must do NOTHING. The drift test imports
// renderSkillBlock, and a top-level CLI would have rewritten the shipped help
// from inside `vitest run` — a test that repairs what it is meant to catch.
function main() {
  const current = readFileSync(HELP_FILE, 'utf8');
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin === -1 || end === -1) {
    logger.error(`${HELP_FILE}: generated-block markers not found`);
    process.exit(1);
  }
  const next = current.slice(0, begin) + renderSkillBlock() + current.slice(end + END.length);

  if (process.argv.includes('--check')) {
    if (next === current) {
      logger.log('help-doc skill list is up to date.');
      return;
    }
    logger.error('help-doc skill list has drifted from scaffold/workspace/.wiki/skills/.');
    logger.error('Run: npm run generate:help-skills');
    process.exit(1);
  }

  if (next === current) logger.log('help-doc skill list already up to date.');
  else {
    writeFileSync(HELP_FILE, next);
    logger.log(`Updated ${HELP_FILE}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
