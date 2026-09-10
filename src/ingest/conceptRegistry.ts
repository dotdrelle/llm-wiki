import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { foldersAreNearDuplicates } from './consolidationValidate.ts';
import { loadConceptSynonymGroups } from './conceptSynonyms.ts';

/**
 * Read model for the concept folders: the registry `wiki doctor` reports and
 * the served concept index will render. One scan of wiki/concepts/ — leaf
 * counts, the tags the leaves declare, naming violations and near-duplicate
 * families, computed with the same near-duplicate function the consolidation
 * validation uses (workspace synonym groups included). Nothing here writes:
 * renaming a folder is a filing decision, never an automatic repair.
 */
export type ConceptFolderEntry = {
  folder: string;
  leaves: number;
  tags: string[];
  namingIssues: string[];
};

export type ConceptRegistry = {
  entries: ConceptFolderEntry[];
  nearDuplicates: Array<{ left: string; right: string }>;
  synonymErrors: string[];
};

export function folderNamingIssues(folder: string): string[] {
  const issues: string[] = [];
  if (/[A-Z_\s]/.test(folder)) issues.push('not kebab-case');
  if (/[sx]$/.test(folder)) issues.push('plural');
  if (/[^\x00-\x7f]/.test(folder)) issues.push('non-ascii');
  if (/--|^-|-$/.test(folder)) issues.push('malformed dashes');
  return issues;
}

export function listConceptRegistry(rootDir: string): ConceptRegistry {
  const conceptsRoot = path.join(rootDir, 'wiki', 'concepts');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(conceptsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    dirs = [];
  }
  const { groups, errors: synonymErrors } = loadConceptSynonymGroups(rootDir);
  const entries: ConceptFolderEntry[] = [];
  for (const folder of dirs.sort((a, b) => a.localeCompare(b))) {
    const leaves = fg.sync('*.md', { cwd: path.join(conceptsRoot, folder), onlyFiles: true });
    const tags = new Set<string>();
    for (const leaf of leaves.slice(0, 20)) {
      try {
        const parsed = matter(readFileSync(path.join(conceptsRoot, folder, leaf), 'utf8'));
        for (const tag of Array.isArray(parsed.data.tags) ? parsed.data.tags : []) {
          tags.add(String(tag));
        }
      } catch {
        // Unreadable leaf: count it, skip its tags.
      }
    }
    entries.push({ folder, leaves: leaves.length, tags: [...tags].sort(), namingIssues: folderNamingIssues(folder) });
  }
  const nearDuplicates: Array<{ left: string; right: string }> = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (foldersAreNearDuplicates(entries[i]!.folder, entries[j]!.folder, groups)) {
        const [left, right] = [entries[i]!.folder, entries[j]!.folder].sort();
        nearDuplicates.push({ left, right });
      }
    }
  }
  return { entries, nearDuplicates, synonymErrors };
}
