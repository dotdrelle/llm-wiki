import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderSidebar } from '../src/serve/html/wikiHtml.ts';
import { WIKI_LAYOUT_SCRIPT } from '../src/serve/html/wikiLayoutScript.ts';
import { WIKI_LAYOUT_CSS } from '../src/serve/html/wikiLayoutCss.ts';
import { WIKI_PANEL_SCRIPT } from '../src/chat/views/wikiPanelScript.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sidebar-tree-'));
  for (const file of [
    'wiki/concepts/reseau.md',
    'templates/rapport.md',
    'build-context/regles.md',
    'deliverables/synthese.md',
    'raw/untracked/lot/source.md',
  ]) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), '# x\n', 'utf8');
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a single set of attributes for the whole panel', () => {
  it('renders the same data-tree-* in every section', async () => {
    // Drag-and-drop, delete, and create used to exist only for Pending.
    // Giving each section its own attribute set would have meant five
    // copies of the same handlers to keep in sync.
    const html = await renderSidebar(root);

    for (const file of [
      'wiki/concepts/reseau.md',
      'templates/rapport.md',
      'build-context/regles.md',
      'deliverables/synthese.md',
      'raw/untracked/lot/source.md',
    ]) {
      expect(html, file).toContain(`data-tree-drag="${file}"`);
      expect(html, file).toContain(`data-tree-delete="${file}"`);
    }
    // No more Pending-only attribute for these three actions.
    expect(html).not.toContain('data-untracked-drag');
    expect(html).not.toContain('data-untracked-delete');
    expect(html).not.toContain('data-untracked-drop');
  });

  it('offers folder creation in collections, not in the fixed wiki taxonomy or Pending', async () => {
    const html = await renderSidebar(root);

    // The wiki section is a fixed taxonomy (answers/concepts/sources), not a
    // folder the reader invents: folder creation stays for the collections
    // (templates, build-context, deliverables) where sub-folders still matter.
    expect(html).not.toContain('data-tree-new-folder="wiki"');
    expect(html).not.toContain('data-tree-new-folder="wiki/concepts"');
    expect(html).toContain('data-tree-new-folder="templates"');
    // Pending is fed by ingestion and uploads: creating a folder there by
    // hand has no recipient.
    expect(html).not.toContain('data-tree-new-folder="raw/untracked"');
  });

  it('keeps empty folders visible and deletable in every tree', async () => {
    for (const directory of [
      'wiki/empty-wiki',
      'templates/empty-template',
      'build-context/empty-context',
      'deliverables/empty-build',
      'raw/untracked/empty-pending',
    ]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }

    const html = await renderSidebar(root);

    for (const directory of [
      'wiki/empty-wiki',
      'templates/empty-template',
      'build-context/empty-context',
      'deliverables/empty-build',
      'raw/untracked/empty-pending',
    ]) {
      expect(html, directory).toContain(`data-tree-id="${directory}"`);
      expect(html, directory).toContain(`data-tree-delete="${directory}"`);
    }
  });

  it('makes a section root neither draggable nor deletable', async () => {
    const html = await renderSidebar(root);

    expect(html).not.toContain('data-tree-drag="wiki"');
    expect(html).not.toContain('data-tree-delete="wiki"');
    expect(html).not.toContain('data-tree-delete="templates"');
    // It stays a drop target, otherwise nothing would let a file be moved
    // back to its section's root.
    expect(html).toContain('data-tree-drop="wiki"');
  });

  it('no longer sets the stopPropagation that hid the delete click', async () => {
    // This was bug T12: the handler is delegated to the document, so
    // stopPropagation kept it from ever seeing the event.
    const html = await renderSidebar(root);
    expect(html).not.toContain('onclick="event.stopPropagation()">×');
  });
});

describe('panel refresh', () => {
  it('replaces the whole tree, not just Pending', () => {
    // It used to replace only [data-untracked-list]: after an ingestion,
    // Pending emptied on screen while wiki/, deliverables/, and templates/
    // stayed as-is — the sections most likely to have changed.
    expect(WIKI_LAYOUT_SCRIPT).toContain("['nav.side-tree', 'innerHTML']");
    expect(WIKI_LAYOUT_SCRIPT).toContain("['[data-untracked-list]', 'innerHTML']");
    expect(WIKI_LAYOUT_SCRIPT).toContain("['[data-untracked-count]', 'textContent']");
  });

  it('preserves open folders', () => {
    // Which folders are open is where the reader currently is; it is not
    // server state to be rebuilt.
    expect(WIKI_LAYOUT_SCRIPT).toContain('const openBefore = new Set(');
    expect(WIKI_LAYOUT_SCRIPT).toContain('node.open = openBefore.has(id)');
  });
});

describe('drag-and-drop visible in both themes', () => {
  it('marks the source with more than just opacity', () => {
    // Opacity alone plus a dotted outline went unnoticed on a dark
    // background: the move looked broken even though it worked.
    expect(WIKI_LAYOUT_CSS).toMatch(/\.is-dragging \{[^}]*opacity[^}]*outline/s);
  });

  it('gives the target a background in addition to its outline', () => {
    expect(WIKI_LAYOUT_CSS).toMatch(/\.is-drop-target \{[^}]*outline: 2px solid/s);
    expect(WIKI_LAYOUT_CSS).toMatch(/\.is-drop-target \{[^}]*background: color-mix/s);
  });
});

describe('History', () => {
  it('is reachable from the sidebar', async () => {
    // The route existed; no link led to it. A page you cannot reach does
    // not exist for whoever is looking for it.
    const html = await renderSidebar(root);
    expect(html).toContain('href="/history"');
  });
});

describe('Ctrl/K palette', () => {
  it('no longer silently truncates to nine results', () => {
    // Pages under wiki/concepts and wiki/sources fell behind the
    // deliverables and templates that global alphabetical sort places
    // first, with nothing saying more remained.
    expect(WIKI_PANEL_SCRIPT).toContain('const CMDK_PAGE_LIMIT = 25');
    expect(WIKI_PANEL_SCRIPT).not.toContain('.slice(0, nq ? 9 : 5)');
  });

  it('ranks by relevance before truncating', () => {
    expect(WIKI_PANEL_SCRIPT).toContain('function cmdkPageRank(page, nq)');
    expect(WIKI_PANEL_SCRIPT).toContain('if (title.startsWith(nq)) return 0;');
    expect(WIKI_PANEL_SCRIPT).toContain('.sort((a, b) => a.rank - b.rank || a.index - b.index)');
  });

  it('announces what stays hidden', () => {
    expect(WIKI_PANEL_SCRIPT).toContain("more page(s) match — refine the search");
    // The line is informational: activating it must not close the palette
    // and lose the search in progress.
    expect(WIKI_PANEL_SCRIPT).toContain("if (item.type === 'note') return;");
  });

  it('exposes History as an action', () => {
    expect(WIKI_PANEL_SCRIPT).toContain("title: 'History'");
  });
});

// Une section affichait ses deux actions écartées l'une de l'autre : chaque
// .side-folder-action portait margin-left:auto, et le flex répartissait donc
// l'espace entre elles — le bouton « nouveau dossier » se retrouvait au milieu
// de la ligne. C'est au label de pousser le groupe, une seule fois.
describe('sidebar folder actions', () => {
  it('groups the folder actions on the right through the label, not each button', async () => {
    const source = WIKI_LAYOUT_CSS;

    // `.side-folder-primary > summary .side-folder-label` apparaît avant : on
    // vise la règle autonome, en début de ligne.
    const labelBlock = source.slice(source.indexOf('\n    .side-folder-label {'));
    expect(labelBlock.slice(0, labelBlock.indexOf('}'))).toContain('margin-right: auto;');

    const actionBlock = source.slice(source.indexOf('\n    .side-folder-action {'));
    expect(actionBlock.slice(0, actionBlock.indexOf('}'))).not.toContain('margin-left: auto;');
  });

  it('uses a folder pictogram for the new-folder action instead of the +square glyph', async () => {
    const html = await readFile(
      new URL('../src/serve/html/wikiHtml.ts', import.meta.url),
      'utf8',
    );

    expect(html).toContain('side-folder-action side-folder-action-icon');
    expect(html).toContain('title="New folder"');
    expect(html).not.toContain('>+□</button>');
  });
});
