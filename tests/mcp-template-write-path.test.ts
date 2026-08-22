import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWritablePath, templateHardContentViolations } from '../src/services/mcpServer.ts';
import type { WorkspaceService } from '../src/services/workspaceService.ts';

// resolveWritablePath is the single guard for template_write and
// build_context_write. It accepts a path either relative to the workspace root
// or relative to the target directory — the same leniency
// resolveTemplateBuildContext grants to build_context entries — and must never
// let that leniency, nor the percent-decode step, widen the boundary.

const root = path.resolve('/ws');
const workspace = {
  paths: {
    rootDir: root,
    templatesDir: path.join(root, 'templates'),
    buildContextDir: path.join(root, 'build-context'),
  },
} as unknown as WorkspaceService;

const templates = () => workspace.paths.templatesDir;
const buildContext = () => workspace.paths.buildContextDir;

describe('resolveWritablePath', () => {
  it('accepts a path relative to the target directory', () => {
    expect(resolveWritablePath(workspace, 'notes/basic-note.md', templates(), 'templates/'))
      .toBe(path.join(root, 'templates', 'notes', 'basic-note.md'));
  });

  it('accepts the same path spelled from the workspace root', () => {
    expect(
      resolveWritablePath(workspace, 'templates/notes/basic-note.md', templates(), 'templates/'),
    ).toBe(path.join(root, 'templates', 'notes', 'basic-note.md'));
  });

  it('does not confuse the two directories', () => {
    expect(
      resolveWritablePath(workspace, 'build-context/rules/citations.md', buildContext(), 'build-context/'),
    ).toBe(path.join(root, 'build-context', 'rules', 'citations.md'));
    // "templates/..." is not a build-context prefix, so it is taken literally
    // *inside* build-context/ rather than escaping to the sibling directory.
    expect(
      resolveWritablePath(workspace, 'templates/x.md', buildContext(), 'build-context/'),
    ).toBe(path.join(root, 'build-context', 'templates', 'x.md'));
  });

  it('rejects traversal, absolute paths and encoded traversal', () => {
    expect(() => resolveWritablePath(workspace, '../wiki/index.md', templates(), 'templates/'))
      .toThrow();
    expect(() => resolveWritablePath(workspace, '/etc/passwd', templates(), 'templates/'))
      .toThrow();
    expect(() => resolveWritablePath(workspace, '%2e%2e%2f%2e%2e%2fetc/passwd', templates(), 'templates/'))
      .toThrow();
    expect(() => resolveWritablePath(workspace, 'templates/../.wikirc.yaml', templates(), 'templates/'))
      .toThrow(/Access denied/);
  });

  it('normalizes backslashes instead of treating them as a filename', () => {
    expect(resolveWritablePath(workspace, 'notes\\basic-note.md', templates(), 'templates/'))
      .toBe(path.join(root, 'templates', 'notes', 'basic-note.md'));
  });

  it('rejects an empty path', () => {
    expect(() => resolveWritablePath(workspace, '   ', templates(), 'templates/'))
      .toThrow(/Access denied/);
  });
});

describe('templateHardContentViolations', () => {
  it('accepts a template made only of frontmatter, headings and instruction blocks', () => {
    const content = [
      '---',
      'title: "Presentation"',
      'build_context: []',
      '---',
      '',
      '# Presentation',
      '',
      '## Intro',
      '',
      '[[INSTRUCTION:',
      'Describe the project purpose.',
      '[src: wiki/concepts/acpi.md]',
      ']]',
      '',
      '## Next',
      '',
      '[[INSTRUCTION:',
      'Describe the approach.',
      ']]',
      '',
    ].join('\n');
    expect(templateHardContentViolations(content)).toEqual([]);
  });

  it('flags prose written outside an instruction block', () => {
    const content = [
      '---',
      'title: "Presentation"',
      'build_context: []',
      '---',
      '',
      '# Presentation',
      '',
      '## Intro',
      '',
      'Le projet ACPI est un système de gestion financière. [src: wiki/concepts/acpi.md]',
      '',
      '[[INSTRUCTION:',
      'Describe the project purpose.',
      ']]',
      '',
    ].join('\n');
    expect(templateHardContentViolations(content)).toContain(
      'Le projet ACPI est un système de gestion financière. [src: wiki/concepts/acpi.md]',
    );
  });
});
