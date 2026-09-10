import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * Authored folder synonyms: groups of folder names that are the SAME real
 * category under different vocabulary. "produit" and "solution-logicielle"
 * share no lexical token, so no stemming can catch them — only an authored
 * equivalence can. The built-in list ships the families found so far; a
 * workspace extends it with its own `.wiki/concept-synonyms.yaml`:
 *
 * ```yaml
 * groups:
 *   - [produit, solution-logicielle, progiciel, application, outil]
 * ```
 *
 * The list is read by the consolidation validation (near-duplicate folder
 * conflicts) and by `wiki doctor` (registry + naming report). Keep it small:
 * every entry means "these folders must never coexist".
 */
export const DEFAULT_FOLDER_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['produit', 'solution', 'solution-logicielle', 'logiciel', 'progiciel', 'application', 'outil',
    'vendor', 'fournisseur', 'editeur'],
];

export type ConceptSynonymGroups = readonly (readonly string[])[];

export function loadConceptSynonymGroups(rootDir: string): {
  groups: ConceptSynonymGroups;
  errors: string[];
} {
  const file = path.join(rootDir, '.wiki', 'concept-synonyms.yaml');
  if (!existsSync(file)) return { groups: DEFAULT_FOLDER_SYNONYM_GROUPS, errors: [] };
  let parsed: unknown = null;
  try {
    parsed = YAML.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      groups: DEFAULT_FOLDER_SYNONYM_GROUPS,
      errors: [`concept-synonyms.yaml unreadable: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const errors: string[] = [];
  const groups: string[][] = [];
  const owner = new Map<string, number>();
  const raw = (parsed && typeof parsed === 'object' && 'groups' in (parsed as Record<string, unknown>))
    ? (parsed as Record<string, unknown>).groups
    : [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(entry)) {
      errors.push('each group must be a list of folder names');
      continue;
    }
    const group: string[] = [];
    for (const item of entry) {
      const key = String(item ?? '').trim();
      if (!key) continue;
      if (owner.has(key)) {
        errors.push(`folder "${key}" appears in several groups (${owner.get(key)} and ${groups.length})`);
      } else {
        owner.set(key, groups.length);
      }
      group.push(key);
    }
    if (group.length > 1) groups.push(group);
    else if (group.length === 1) errors.push(`group with a single folder "${group[0]}" declares nothing`);
  }
  return { groups: [...DEFAULT_FOLDER_SYNONYM_GROUPS, ...groups], errors };
}
