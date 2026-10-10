/**
 * The order a reader expects for displayed labels: alphabetical on what is
 * SHOWN, accents and case ignored ("Étude" beside "Etude", not after "Z"),
 * numbers by value ("2" before "10"). Unicode root collation, so no workspace
 * language is assumed.
 *
 * Lists were sorted on file paths, so a page's place depended on its source
 * folder, not on its title: "Bilan", "Démo", "Divers", "Étude", then
 * "Open-Source…" and "Demo Project Brief" in Reading notes.
 */
const collator = new Intl.Collator('und', { sensitivity: 'base', numeric: true });

export function compareLabels(a: string, b: string): number {
  return collator.compare(a, b);
}
