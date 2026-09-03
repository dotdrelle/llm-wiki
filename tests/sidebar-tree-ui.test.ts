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

  it('keeps empty folders visible and deletable in the wiki tree and collections', async () => {
    for (const directory of [
      'wiki/empty-wiki',
      'templates/empty-template',
      'build-context/empty-context',
      'deliverables/empty-build',
    ]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }

    const html = await renderSidebar(root);

    for (const directory of [
      'wiki/empty-wiki',
      'templates/empty-template',
      'build-context/empty-context',
      'deliverables/empty-build',
    ]) {
      expect(html, directory).toContain(`data-tree-id="${directory}"`);
      expect(html, directory).toContain(`data-tree-delete="${directory}"`);
    }
  });

  it('shows only Pending folders that hold a document directly, and collapses empty ancestor chains', async () => {
    // Pending is the inbox of documents, not of folders: a directory no
    // source sits DIRECTLY under is scaffolding, not structure. Six empty
    // ancestor levels in front of the first document must not each cost a
    // line — the first folder that holds a document becomes the top level.
    await mkdir(path.join(root, 'raw/untracked/empty-pending'), { recursive: true });
    await mkdir(path.join(root, 'raw/untracked/lot/sous-lot'), { recursive: true });
    await writeFile(path.join(root, 'raw/untracked/lot/sous-lot/note.md'), '# x\n', 'utf8');
    await mkdir(path.join(root, 'raw/untracked/a/b/c'), { recursive: true });
    await writeFile(path.join(root, 'raw/untracked/a/b/c/profond.md'), '# x\n', 'utf8');

    const html = await renderSidebar(root);

    expect(html).not.toContain('data-tree-id="raw/untracked/empty-pending"');
    // The folder chain down to a real document is preserved when every level
    // holds a document itself.
    expect(html).toContain('data-tree-id="raw/untracked/lot"');
    expect(html).toContain('data-tree-id="raw/untracked/lot/sous-lot"');
    expect(html).toContain('data-tree-drag="raw/untracked/lot/sous-lot/note.md"');
    // The empty ancestors a/ and a/b/ of the deep document are collapsed:
    // c/ appears at the top, carrying its document, without the scaffolding.
    expect(html).not.toContain('data-tree-id="raw/untracked/a"');
    expect(html).not.toContain('data-tree-id="raw/untracked/a/b"');
    expect(html).toContain('data-tree-id="raw/untracked/a/b/c"');
    expect(html).toContain('data-tree-drag="raw/untracked/a/b/c/profond.md"');
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
    expect(WIKI_LAYOUT_SCRIPT).toContain("['.side-collections', 'innerHTML']");
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

describe('sidebar views', () => {
  it('splits the sidebar into three views behind an icon rail, Pending by default', async () => {
    const html = await renderSidebar(root);

    expect(html).toContain('aria-label="Sidebar views"');
    expect(html).toContain('data-side-view="wiki"');
    expect(html).toContain('data-side-view="files"');
    expect(html).toContain('data-side-view="pending"');
    expect(html).toContain('data-side-view-pane="wiki"');
    expect(html).toContain('data-side-view-pane="files"');
    expect(html).toContain('data-side-view-pane="pending"');
    // Pending is the default view: its pane ships visible, the others hidden.
    expect(html).toContain('<section class="side-view-pane" data-side-view-pane="pending" role="tabpanel" aria-label="Pending sources">');
    expect(html).toContain('data-side-view-pane="wiki" role="tabpanel" aria-label="Wiki pages" hidden');
    expect(html).toContain('data-side-view-pane="files" role="tabpanel" aria-label="Context, templates, deliverables" hidden');
    expect(WIKI_LAYOUT_SCRIPT).toContain("let activeView = localStorage.getItem(viewKey) || 'pending';");
    // The wiki tree lives in its own view now: it never shares its column
    // with the Pending stack or the collection tabs.
    expect(html).toContain('<nav class="side-tree" aria-label="Wiki pages">');
    expect(html).not.toContain('data-pending-resizer');
  });

  it('orders the collection tabs context, templates, deliverables', async () => {
    const html = await renderSidebar(root);

    const tabs = html.slice(html.indexOf('aria-label="Collections"'));
    const context = tabs.indexOf('data-collection="build-context"');
    const templates = tabs.indexOf('data-collection="templates"');
    const deliverables = tabs.indexOf('data-collection="deliverables"');
    expect(context).toBeGreaterThan(-1);
    expect(templates).toBeGreaterThan(context);
    expect(deliverables).toBeGreaterThan(templates);
    // The first tab — context — is the active one.
    expect(tabs).toContain('>context</button>');
    expect(WIKI_LAYOUT_SCRIPT).toContain("let activeCollection = localStorage.getItem(collectionKey) || 'build-context';");
  });

  it('moves to the view that holds a search match', () => {
    // A match in a hidden view must not stay invisible: the filter runs over
    // the whole sidebar and jumps to the first view that shows one.
    expect(WIKI_LAYOUT_SCRIPT).toContain('const VIEW_ORDER = [\'wiki\', \'files\', \'pending\'];');
    expect(WIKI_LAYOUT_SCRIPT).toContain('[data-side-path]:not(.is-search-hidden)');
    expect(WIKI_LAYOUT_SCRIPT).toContain('activeView = next;');
  });

  it('stamps dragged .md rows with the chat context MIME without breaking tree moves', () => {
    // The same drag that moves a file between folders becomes "add to Donna"
    // when dropped on the chat: the payload is additive, moves keep working.
    expect(WIKI_LAYOUT_SCRIPT).toContain("event.dataTransfer.effectAllowed = 'copyMove';");
    expect(WIKI_LAYOUT_SCRIPT).toContain("event.dataTransfer.setData('application/x-llm-wiki-context', dragPath)");
    expect(WIKI_LAYOUT_SCRIPT).toContain("dragPath.startsWith('wiki/') || dragPath.startsWith('raw/untracked/')");
    expect(WIKI_LAYOUT_SCRIPT).toContain("kind === 'file' && dragPath.endsWith('.md')");
  });
});

describe('pending status colours', () => {
  it('marks a pending source green when its subject is new', async () => {
    const html = await renderSidebar(root);

    expect(html).toContain('class="side-untracked-item side-untracked-new"');
  });

  it('marks a pending source blue when the same subject exists and differs', async () => {
    await writeFile(path.join(root, 'wiki/concepts/source.md'), '# Ancien contenu.\n', 'utf8');

    const html = await renderSidebar(root);

    expect(html).toContain('class="side-untracked-item side-untracked-update"');
    expect(html).not.toContain('side-untracked-new');
  });

  it('leaves an identical re-drop unmarked', async () => {
    await writeFile(path.join(root, 'wiki/concepts/source.md'), '# x\n', 'utf8');

    const html = await renderSidebar(root);

    expect(html).not.toContain('side-untracked-new');
    expect(html).not.toContain('side-untracked-update');
  });

  it('styles the two statuses in the layout css', () => {
    expect(WIKI_LAYOUT_CSS).toContain('.side-untracked-item.side-untracked-new .side-untracked-link');
    expect(WIKI_LAYOUT_CSS).toContain('.side-untracked-item.side-untracked-update .side-untracked-link');
  });
});

describe('titles in the tree', () => {
  it('reads a wiki page by its first heading, not by its filename', async () => {
    await writeFile(
      path.join(root, 'wiki/concepts/reseau.md'),
      '---\ntype: note\n---\n\n# Architecture du réseau\n\nCorps du document.\n',
      'utf8',
    );

    const html = await renderSidebar(root);

    expect(html).toContain('>Architecture du réseau</a>');
    expect(html).not.toContain('>reseau</a>');
    // The path is not lost: it stays on the tooltip and the data attribute.
    expect(html).toContain('title="wiki/concepts/reseau.md"');
    expect(html).toContain('data-side-path="wiki/concepts/reseau.md"');
  });

  it('keeps the filename when the page has no heading', async () => {
    await writeFile(path.join(root, 'wiki/concepts/reseau.md'), 'Sans titre.\n', 'utf8');

    const html = await renderSidebar(root);

    // Falls back to the filename; a concept subject is shown with a leading
    // capital, so `reseau` reads as `Reseau`.
    expect(html).toContain('>Reseau</a>');
  });

  it('shows a concept folder in capitals and its subjects with a leading capital', async () => {
    await mkdir(path.join(root, 'wiki/concepts/offre-marche'), { recursive: true });
    await writeFile(path.join(root, 'wiki/concepts/offre-marche/anaplan.md'), '# anaplan platform\n', 'utf8');
    await writeFile(path.join(root, 'wiki/concepts/offre-marche/s3ns.md'), 'no heading here\n', 'utf8');

    const html = await renderSidebar(root);

    expect(html).toContain('<span class="side-folder-label">OFFRE MARCHE</span>');
    expect(html).toContain('>Anaplan platform</a>');
    expect(html).toContain('>S3ns</a>');
    // The section folder itself is not shouted.
    expect(html).toContain('<span class="side-folder-label">concepts</span>');
    // The path is untouched.
    expect(html).toContain('data-tree-id="wiki/concepts/offre-marche"');
  });

  it('strips the leading transport hash of downloaded Pending files', async () => {
    await writeFile(path.join(root, 'raw/untracked/8d5e3fe3-ACPI_RapportEtudeDonneesAmont_V0.md'), '# x\n', 'utf8');

    const html = await renderSidebar(root);

    expect(html).toContain('>ACPI RapportEtudeDonneesAmont V0</a>');
    expect(html).not.toContain('>8d5e3fe3</a>');
    expect(html).not.toContain('>8d5e3fe3 ACPI</a>');
  });

  it('strips the transport id carried by the converted frontmatter title', async () => {
    // The documents agent derives the `title` frontmatter from the source
    // filename, so a converted Pending upload stores its id there too — the
    // filename strip alone is not enough, the title must be cleaned as well.
    await writeFile(
      path.join(root, 'raw/untracked/3f2a1b9c-mon_rapport.md'),
      '---\ntitle: "3f2a1b9c mon rapport"\n---\n\n# x\n',
      'utf8',
    );

    const html = await renderSidebar(root);

    expect(html).toContain('>mon rapport</a>');
    expect(html).not.toContain('>3f2a1b9c</a>');
    expect(html).not.toContain('3f2a1b9c mon rapport');
  });
});

describe('wiki tree chrome', () => {
  it('drops the blue frame around the wiki tree but keeps the wiki line highlighted', () => {
    // The accent border used to box the whole wiki section, children
    // included. The background now sits on the "wiki" summary line only.
    const rule = WIKI_LAYOUT_CSS.slice(
      WIKI_LAYOUT_CSS.indexOf('.side-folder-row.side-folder-primary {'),
      WIKI_LAYOUT_CSS.indexOf('\n    .side-folder-label {'),
    );
    expect(rule).not.toContain('border: 1px solid');
    expect(rule).toContain('.side-folder-row.side-folder-primary summary { color: var(--accent); background: var(--accent-soft); }');
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
