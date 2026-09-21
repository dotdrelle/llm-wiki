/*
 * The single switch for the provenance work (`plan-provenance-feuilles.md`).
 * Off unless the operator opts in, so the active corpus never migrates in
 * silence: readers of the flag all agree on its spelling.
 */
export function provenanceModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(String(env.WIKI_PROVENANCE_MODE ?? '').trim());
}
