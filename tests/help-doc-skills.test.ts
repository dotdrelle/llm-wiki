import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/*
 The help must not be able to fall behind the shipped skills.

 It did: the concepts rework added wiki-rebuild-concepts, wiki-reclassify and
 wiki-taxonomy, and help-doc kept advertising the six skills it already knew.
 A user reading `/help` could not discover the three that mattered most to the
 new lifecycle, and nothing failed.

 The list is now generated from scaffold/workspace/.wiki/skills/ into
 08-commands-serve.md. These tests are what makes the generation binding.
*/

const SKILLS_DIR = join(process.cwd(), 'scaffold/workspace/.wiki/skills');
const HELP_FILE = join(process.cwd(), 'help-doc/08-commands-serve.md');

function skillNames(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''))
    .sort();
}

function generatedBlock(): string {
  const help = readFileSync(HELP_FILE, 'utf8');
  const begin = help.indexOf('<!-- BEGIN GENERATED SKILLS');
  const end = help.indexOf('<!-- END GENERATED SKILLS -->');
  expect(begin, 'the generated-block markers must exist').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return help.slice(begin, end);
}

describe('help-doc skill list', () => {
  it('lists every shipped skill, and only those', () => {
    const block = generatedBlock();
    const listed = [...block.matchAll(/^- `\/([a-z0-9-]+)/gm)].map((match) => match[1]).sort();
    expect(listed).toEqual(skillNames());
  });

  it('gives each skill its own declared description and parameters', () => {
    const block = generatedBlock();
    for (const name of skillNames()) {
      const raw = readFileSync(join(SKILLS_DIR, `${name}.md`), 'utf8');
      const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? '';
      const description = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
      const params = [...front.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((match) => match[1]);
      expect(description, `${name} must declare a description`).not.toBe('');

      const line = block.split('\n').find((item) => item.startsWith(`- \`/${name}`));
      expect(line, `${name} must appear in the help`).toBeDefined();
      // Parameters are what the user types; a skill that gains one and does not
      // say so in the help is the same silent drift, one level down.
      for (const param of params) expect(line).toContain(`[${param}]`);
      const tail = description.replace(/\.$/, '');
      expect(line!.toLowerCase()).toContain(tail.toLowerCase());
    }
  });

  // Through the CLI rather than an import: this is the exact contract CI runs
  // (`npm run check-help-skills`), and --check never writes, so the test can
  // never repair the drift it is meant to catch.
  it('passes the generator check the release gate runs', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-help-skills.js', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.stderr + result.stdout).toBeTruthy();
    expect(result.status, result.stderr).toBe(0);
  });
});
