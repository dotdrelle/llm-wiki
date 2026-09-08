import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveReadableWorkspacePath } from '../src/services/mcpServer.ts';
import type { WorkspaceService } from '../src/services/workspaceService.ts';

// resolveReadableWorkspacePath percent-decodes the requested path BEFORE the
// boundary checks (so UI-encoded accents resolve), which means the decode must
// never let an encoded traversal or an out-of-scope root slip through.

const root = path.resolve('/ws');
const workspace = {
  paths: {
    rootDir: root,
    wikiDir: path.join(root, 'wiki'),
    rawIngestedDir: path.join(root, 'raw', 'ingested'),
    rawUntrackedDir: path.join(root, 'raw', 'untracked'),
  },
} as unknown as WorkspaceService;

describe('resolveReadableWorkspacePath decoding', () => {
  it('resolves percent-encoded accented filenames under wiki/', () => {
    const resolved = resolveReadableWorkspacePath(workspace, 'wiki/proc%C3%A9dures/d%C3%A9ploiement.md');
    expect(resolved).toBe(path.join(root, 'wiki', 'procédures', 'déploiement.md'));
  });

  it('rejects percent-encoded traversal out of the workspace', () => {
    expect(() => resolveReadableWorkspacePath(workspace, 'wiki/%2e%2e/%2e%2e/etc/passwd'))
      .toThrow();
    expect(() => resolveReadableWorkspacePath(workspace, '%2e%2e%2fsecret.md')).toThrow();
  });

  it('rejects decoded paths that land outside the readable roots', () => {
    expect(() => resolveReadableWorkspacePath(workspace, 'raw%2Fingested%2F..%2F..%2F.env'))
      .toThrow(/Access denied/);
    expect(() => resolveReadableWorkspacePath(workspace, '.wiki/profile.md'))
      .toThrow(/Access denied/);
  });

  it('keeps malformed percent sequences literal instead of failing open', () => {
    expect(resolveReadableWorkspacePath(workspace, 'wiki/%E0%A4%A.md'))
      .toBe(path.join(root, 'wiki', '%E0%A4%A.md'));
  });

  it('accepts an absolute path that lands inside a readable root', () => {
    expect(resolveReadableWorkspacePath(workspace, path.join(root, 'raw', 'untracked', 'x.md')))
      .toBe(path.join(root, 'raw', 'untracked', 'x.md'));
    expect(resolveReadableWorkspacePath(workspace, path.join(root, 'wiki', 'a', 'b.md')))
      .toBe(path.join(root, 'wiki', 'a', 'b.md'));
  });

  it('rejects an absolute path inside the workspace but outside the readable roots', () => {
    expect(() => resolveReadableWorkspacePath(workspace, path.join(root, 'templates', 'x.md')))
      .toThrow(/Access denied/);
    expect(() => resolveReadableWorkspacePath(workspace, '/elsewhere/raw/untracked/x.md'))
      .toThrow();
  });

  it('accepts a manager-style workspaces/<name>/ prefix that lands under a readable root', () => {
    expect(resolveReadableWorkspacePath(workspace, 'workspaces/acpi/raw/untracked/x.md'))
      .toBe(path.join(root, 'raw', 'untracked', 'x.md'));
    expect(() => resolveReadableWorkspacePath(workspace, 'workspaces/acpi/templates/x.md'))
      .toThrow(/Access denied/);
    expect(() => resolveReadableWorkspacePath(workspace, 'workspaces/acpi/../raw/ingested/x.md'))
      .toThrow();
  });
});
