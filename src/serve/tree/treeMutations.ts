import { mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveInside } from '../../utils/path.ts';

/**
 * Mutations d'arborescence du panneau gauche, pour TOUTES ses sections.
 *
 * Seul `raw/untracked/` était manipulable : supprimer, déplacer. Les autres
 * sections — wiki, templates, build-context, deliverables — n'avaient ni
 * déplacement, ni création ou suppression de dossier. Écrire une seconde
 * implémentation par section aurait multiplié par cinq les endroits où la
 * garantie de non-évasion doit être vraie, sans en rendre aucune plus sûre.
 *
 * Ce module est donc paramétré par la racine autorisée. Les sections ne
 * diffèrent que par leur `TreeRoot` ; le mécanisme, lui, est unique — y compris
 * pour Pending, dont l'ancienne API délègue désormais ici.
 */

export type TreeEntryKind = 'file' | 'folder';

export type TreeRoot = {
  /** Chemin relatif du sous-arbre, sans barre finale. */
  root: string;
  /**
   * Extension imposée aux fichiers, ou null pour n'en imposer aucune.
   * Le wiki, les templates et les livrables sont du Markdown : accepter autre
   * chose y créerait des fichiers qu'aucune vue ne sait afficher.
   */
  fileExtension: string | null;
  /**
   * Purger les dossiers que l'opération vient de vider, jusqu'à la racine
   * exclue. Vrai pour Pending, où un dossier n'est qu'un regroupement
   * temporaire ; faux pour le wiki, où un dossier vide est une intention de
   * rangement que personne n'a demandé d'effacer.
   */
  pruneEmptyDirs: boolean;
};

// `EDITABLE_DIRS` de wikiHtml.ts est la même liste vue depuis le rendu. Ici
// elle porte en plus les règles par section, qui n'ont pas de sens côté HTML.
export const TREE_ROOTS: Record<string, TreeRoot> = {
  wiki: { root: 'wiki', fileExtension: '.md', pruneEmptyDirs: false },
  deliverables: { root: 'deliverables', fileExtension: '.md', pruneEmptyDirs: false },
  templates: { root: 'templates', fileExtension: '.md', pruneEmptyDirs: false },
  'build-context': { root: 'build-context', fileExtension: '.md', pruneEmptyDirs: false },
  pending: { root: 'raw/untracked', fileExtension: '.md', pruneEmptyDirs: true },
};

export type TreeResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: 400 | 409; error: string };

function fail(error: string, status: 400 | 409 = 400): TreeResult {
  return { ok: false, status, error };
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Section propriétaire d'un chemin, ou null.
 *
 * C'est ici, et nulle part ailleurs, que se décide ce qu'un chemin fourni par
 * le client a le droit d'être. Un chemin hors des racines connues, ou portant
 * un `..`, n'est pas corrigé : il est refusé.
 */
export function resolveTreeRoot(relativePath: string): TreeRoot | null {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return null;
  for (const entry of Object.values(TREE_ROOTS)) {
    if (normalized === entry.root || normalized.startsWith(`${entry.root}/`)) return entry;
  }
  return null;
}

export function normalizeRelative(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const relative = toPosix(value).replace(/^\/+|\/+$/g, '');
  if (!relative) return null;
  if (relative.split('/').includes('..')) return null;
  return relative;
}

function isRootItself(relativePath: string, root: TreeRoot): boolean {
  return relativePath === root.root;
}

function hasAllowedExtension(relativePath: string, root: TreeRoot): boolean {
  return root.fileExtension === null || relativePath.endsWith(root.fileExtension);
}

export async function deleteEntry(rootDir: string, rawPath: string): Promise<TreeResult> {
  const relativePath = normalizeRelative(rawPath);
  const root = relativePath ? resolveTreeRoot(relativePath) : null;
  if (!relativePath || !root) return fail('path outside the editable tree');
  // Supprimer la racine d'une section reviendrait à supprimer la section.
  if (isRootItself(relativePath, root)) return fail('cannot delete a section root');

  try {
    const absolute = resolveInside(rootDir, relativePath);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await rm(absolute, { recursive: true });
      await pruneEmptyParents(rootDir, path.posix.dirname(relativePath), root);
      return { ok: true, status: 200, body: { path: relativePath, kind: 'folder' } };
    }
    if (!info.isFile() || !hasAllowedExtension(relativePath, root)) {
      return fail(`only ${root.fileExtension ?? 'known'} files can be deleted here`);
    }
    await rm(absolute);
    await pruneEmptyParents(rootDir, path.posix.dirname(relativePath), root);
    return { ok: true, status: 200, body: { path: relativePath, kind: 'file' } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Déplacer une entrée. `toDir` est le dossier DESTINATION ; l'entrée garde son
 * nom. Un déplacement d'une section à une autre est refusé : un template posé
 * dans `wiki/` n'est plus un template, et rien dans l'interface ne dirait ce
 * qu'il est devenu.
 */
export async function moveEntry(
  rootDir: string,
  rawFrom: unknown,
  rawTo: unknown,
): Promise<TreeResult> {
  const from = normalizeRelative(rawFrom);
  const fromRoot = from ? resolveTreeRoot(from) : null;
  if (!from || !fromRoot) return fail('path outside the editable tree');
  if (isRootItself(from, fromRoot)) return fail('cannot move a section root');

  // Destination vide = racine de la section d'origine, seul dossier qui ne
  // s'écrit pas comme un chemin complet dans l'interface.
  const toDir = rawTo === '' || rawTo === undefined || rawTo === null
    ? fromRoot.root
    : normalizeRelative(rawTo);
  const toRoot = toDir ? resolveTreeRoot(toDir) : null;
  if (!toDir || !toRoot) return fail('destination outside the editable tree');
  if (toRoot.root !== fromRoot.root) {
    return fail(`cannot move between sections (${fromRoot.root} → ${toRoot.root})`);
  }

  const name = from.slice(from.lastIndexOf('/') + 1);
  const target = `${toDir}/${name}`;
  if (target === from) return { ok: true, status: 200, body: { from, to: target, unchanged: true } };
  // Déplacer un dossier dans lui-même ou dans un de ses descendants
  // détacherait le sous-arbre : rename() renvoie EINVAL dans le premier cas et
  // se comporte de façon variable selon la plateforme dans le second.
  if (`${toDir}/`.startsWith(`${from}/`)) return fail('cannot move a folder into itself');

  try {
    const source = resolveInside(rootDir, from);
    const destination = resolveInside(rootDir, target);
    const sourceInfo = await stat(source);
    if (sourceInfo.isFile() && !hasAllowedExtension(from, fromRoot)) {
      return fail(`only ${fromRoot.fileExtension ?? 'known'} files can be moved here`);
    }
    const destinationDirInfo = await stat(resolveInside(rootDir, toDir)).catch(() => null);
    if (!destinationDirInfo?.isDirectory()) return fail('destination folder does not exist');
    // Jamais d'écrasement : rename() remplacerait le fichier en silence. La
    // collision appartient à celui qui déplace.
    if (await stat(destination).then(() => true, () => false)) {
      return fail(`already exists: ${target}`, 409);
    }
    await rename(source, destination);
    await pruneEmptyParents(rootDir, path.posix.dirname(from), fromRoot);
    return {
      ok: true,
      status: 200,
      body: { from, to: target, kind: sourceInfo.isDirectory() ? 'folder' : 'file' },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Créer un dossier, ou un fichier vide, à l'intérieur d'une section. */
export async function createEntry(
  rootDir: string,
  rawParent: unknown,
  rawName: unknown,
  kind: TreeEntryKind,
): Promise<TreeResult> {
  const parent = normalizeRelative(rawParent);
  const root = parent ? resolveTreeRoot(parent) : null;
  if (!parent || !root) return fail('parent outside the editable tree');

  const name = typeof rawName === 'string' ? rawName.trim() : '';
  // Un nom n'est qu'un nom : pas de séparateur, donc pas de traversée possible
  // par ce chemin, et pas de création implicite de hiérarchie.
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return fail('invalid name');
  }
  const fileName = kind === 'file' && root.fileExtension && !name.endsWith(root.fileExtension)
    ? `${name}${root.fileExtension}`
    : name;
  const target = `${parent}/${fileName}`;

  try {
    const absolute = resolveInside(rootDir, target);
    if (await stat(absolute).then(() => true, () => false)) {
      return fail(`already exists: ${target}`, 409);
    }
    const parentInfo = await stat(resolveInside(rootDir, parent)).catch(() => null);
    if (!parentInfo?.isDirectory()) return fail('parent folder does not exist');
    if (kind === 'folder') {
      await mkdir(absolute, { recursive: false });
    } else {
      // `wx` : échoue si le fichier existe, plutôt que de le vider. Le test
      // d'existence ci-dessus laisse une fenêtre de course que ce drapeau ferme.
      await writeFile(absolute, '', { encoding: 'utf8', flag: 'wx' });
    }
    return { ok: true, status: 200, body: { path: target, kind } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Purger les dossiers vidés par l'opération, jusqu'à la racine de section
 * exclue. Toujours au mieux : échouer à ranger ne doit pas transformer une
 * suppression réussie en erreur.
 */
async function pruneEmptyParents(
  rootDir: string,
  relativeDir: string,
  root: TreeRoot,
): Promise<void> {
  if (!root.pruneEmptyDirs) return;
  const sectionRoot = resolveInside(rootDir, root.root);
  let current: string;
  try {
    current = resolveInside(rootDir, relativeDir);
  } catch {
    return;
  }
  while (current !== sectionRoot && current.startsWith(`${sectionRoot}${path.sep}`)) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      // rmdir, et non rm : rm() sans `recursive` lève EISDIR même sur un
      // dossier vide, ce qui faisait échouer la suppression du dernier fichier
      // d'un dossier alors que le travail était déjà fait.
      await rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
