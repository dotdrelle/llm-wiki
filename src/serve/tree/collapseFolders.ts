interface FolderNode {
  path: string;
  dirs: Map<string, FolderNode>;
  files: string[];
}

/**
 * Same rule as Pending: only a folder holding at least one document DIRECTLY
 * below it is shown. A chain of folders with no document of its own (the
 * Confluence ancestry an exported page drags into wiki/sources/) is lifted
 * away, so a fiche buried eight folders deep reads under its own folder
 * instead of under eight levels of empty scaffolding. Children are keyed by
 * their full path: two lifted siblings sharing a leaf name must not collide.
 */
export function collapseDocumentlessFolders(node: FolderNode): void {
  const kept = new Map<string, FolderNode>();
  for (const dir of node.dirs.values()) {
    collapseDocumentlessFolders(dir);
    if (dir.files.length > 0) kept.set(dir.path, dir);
    else for (const child of dir.dirs.values()) kept.set(child.path, child);
  }
  node.dirs = kept;
}
