/**
 * Human-readable list summary for commit messages and logs.
 *
 * Shows the first names, then a "+N more" suffix beyond the cap. The cap and
 * the separator live here so a change to the truncation format is made once,
 * not once per command.
 */
export function summarizeNames(names: string[], cap = 5): string {
  const listed = names.slice(0, cap).join(', ');
  const more = names.length > cap ? ` +${names.length - cap} more` : '';
  return listed + more;
}

/**
 * Full commit message for a run, e.g. `build: 3 deliverable(s) — a, b, c`.
 *
 * This is the string that lands in the workspace history, so its exact shape —
 * the `(s)` suffix, the em-dash separator — lives here rather than in each
 * command.
 */
export function summarizeCommit(command: string, noun: string, names: string[]): string {
  return `${command}: ${names.length} ${noun}(s)${names.length ? ` — ${summarizeNames(names)}` : ''}`;
}
