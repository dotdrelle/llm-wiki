import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  `/new-template` is the one skill that authoring questions route to. Three
  regressions were observed on it, each with a cause a rewrite could silently
  undo:

  - the agent reported "created" a template it had never written (the
    template_write contract is preview-unless-confirmed, so a plan is not a
    write);
  - it launched a build although the request was only to author a template;
  - the written path changed between runs (overview/example.md once,
    presentation/project-overview.md the next) because the body gave an
    example path, not a rule.

  These assertions pin the authored body to the shape that removes all three:
  a description that carries the "never build" boundary (the description is
  what the model reads in the catalogue before running the skill), a
  deterministic path derived from the parameters, and an explicit "a preview
  is not a write" completion rule.
*/

const SKILL_PATH = join(process.cwd(), 'scaffold/workspace/.wiki/skills/new-template.md');
const skill = readFileSync(SKILL_PATH, 'utf8');

describe('new-template skill body', () => {
  it('carries the never-build boundary in its description', () => {
    const description = skill.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
    expect(description).toContain('never build');
    expect(description).not.toMatch(/^Design and write/);
  });

  it('derives the path from family and intent, at the root when family is absent', () => {
    expect(skill).toContain('The path is deterministic');
    expect(skill).toContain('The file name is the `intent` parameter, slugified');
    expect(skill).toContain('the subfolder is the `family` parameter, slugified');
    expect(skill).toContain('write directly at the root of `templates/`');
    expect(skill).toContain('templates/project-overview.md');
  });

  it('treats a preview or plan as not-a-write', () => {
    expect(skill).toContain('a preview, a plan, or a pending approval is not a write');
  });

  it('keeps the write under templates/, never under wiki/', () => {
    expect(skill).toContain('its path must start exactly with `templates/`');
    expect(skill).toContain('Incorrect path: `wiki/templates/overview/example.md`');
  });
});
