import type { RegistryCommunity, TaxonomyRegistry } from './schema.ts';

/*
 Filiation explicite et garde-fou de dépréciation massive (plan Lot 3, 6.3).

 Le ré-ancrage ordinaire par Jaccard est fait pour une évolution NON planifiée :
 des pages qui bougent un peu, une communauté qui survit à un remaniement
 mineur. Une réorganisation volontaire de granularité — fusion, scission,
 rapprochement comparatif — déplace souvent plus de la moitié des membres et
 fait passer une communauté existante pour une disparition. Décider d'une
 fusion au seul recouvrement de membres effacerait alors, en une révision, une
 carte que l'utilisateur reconnaissait, sans laisser de quoi la reconstruire.

 Ce module ne réinvente pas `anchorCommunities` : il rapporte ce que le
 registre va faire (qui est absorbé, renommé, déprécié, et vers quoi), puis il
 borne la DISPARITION NON FILIÉE. Une communauté qui disparaît en pointant une
 remplaçante avale sa fraction de la carte sans perte ; une communauté qui
 s'évanouit sans successeur est un trou. Au-delà d'un seuil explicite de trous,
 la publication est refusée, quels que soient les seuils de reconnaissance.

 Aucune règle métier n'entre ici : tout est une opération sur des comptes et
 des identifiants.
*/

/** La filiation d'une communauté est l'opération que cette révision lui fait subir. */
export type LineageOp = 'unchanged' | 'rename' | 'merge' | 'split' | 'move' | 'created';

export type LineageEntry =
  | { id: string; op: LineageOp }
  | { id: string; op: 'merge'; into: string }
  | { id: string; op: 'split'; branches: string[] }
  | { id: string; op: 'move'; into: string };

export type LineageReport = {
  /** Opération appliquée à chaque communauté du précédent cette révision. */
  entries: LineageEntry[];
  /** Communautés du précédent restées sans descendant filié : disparitions réelles. */
  trulyLost: string[];
};

/**
 * Commande de garde-fou : taux maximal de communautés actives du précédent qui
 * peuvent être dépréciées SANS successeur dans une révision.
 *
 * Une valeur de 0.3 dit : une révision peut faire disparaître de la carte au
 * plus ~3 communautés actives sur 10 en trous non filiés ; au-delà, c'est une
 * réorganisation que seul un plan de filiation explicite peut expliquer, et
 * rien ne l'a fournie.
 */
export const MAX_UNFILED_DEPRECATION_RATE = 0.3;

/**
 * Comment garde-fou contre la dépréciation massive non expliquée.
 *
 * Compte, parmi les communautés ACTIVES du registre précédent (jamais
 * dépréciées), celles que cette révision déprécie sans `replacedBy` résoluble —
 * c'est-à-dire un trou de carte, pas une absorption. Si la proportion dépasse
 * le seuil, la publication est refusée.
 *
 * `force` ne doit JAMAIS contourner ce garde-fou : ce n'est pas un seuil de
 * reconnaissance qui tolère qu'on l'assouplisse, c'est la promesse que toute
 * disparition de carte reste traçable. Un `force` qui voudrait quand même
 * déprécier en masse doit d'abord fournir une filiation — ici, des
 * `replacedBy` — et non enfoncer la porte.
 */
export function guardAgainstMassDisruption(
  previous: TaxonomyRegistry | null,
  current: RegistryCommunity[],
  options: { maxUnfiledRate?: number } = {},
): { ok: true } | { ok: false; issues: string[] } {
  if (!previous) return { ok: true };
  const maxRate = options.maxUnfiledRate ?? MAX_UNFILED_DEPRECATION_RATE;

  const activeBefore = previous.communities.filter((c) => !c.deprecated);
  if (activeBefore.length === 0) return { ok: true };

  const currentById = new Map(current.map((c) => [c.id, c]));
  // Résoudre une chaîne de dépréciations : vers quelle communauté VIVANTE cette
  // entrée finit-elle par pointer ?
  const endsAtLive = (id: string): string | null => {
    const seen = new Set<string>();
    let cursor: string | null = id;
    let hops = 0;
    while (cursor && !seen.has(cursor) && hops < 16) {
      seen.add(cursor);
      const entry = currentById.get(cursor);
      if (!entry) return null;
      if (entry.deprecated) {
        cursor = entry.replacedBy ?? null;
        hops += 1;
        continue;
      }
      return cursor;
    }
    return null;
  };

  // Un « trou » : une communauté active d'avant qui soit n'est pas du tout dans
  // la révision, soit est dépréciée sans remplaçante vivante.
  const unfiled: string[] = [];
  for (const before of activeBefore) {
    const id = before.id;
    const target = endsAtLive(id);
    if (target === null) unfiled.push(id);
  }

  const rate = unfiled.length / activeBefore.length;
  if (rate <= maxRate) return { ok: true };

  const issues = [
    `dépréciation non filiée ${Math.round(rate * 100)} % au-delà du plafond ${Math.round(maxRate * 100)} %`,
    `communautés actives disparues sans successeur : ${unfiled.join(', ')}`,
    'fournir une filiation explicite (replacedBy / changeNote) avant de publier; force ne contourne pas ce garde-fou',
  ];
  return { ok: false, issues };
}

/**
 * Rapporte la filiation de chaque communauté du précédent vers cette révision.
 *
 * Utile pour les rapports avant/après (§6.3) et pour décider d'un `split` :
 * deux nouvelles communautés qui n'auraient qu'une seule ascendante commune se
 * partagent une scission, et une ascendante recouvrée sous sa propre identité
 * est "renommée" plutôt que "remplacée".
 */
export function lineageReport(
  previous: TaxonomyRegistry | null,
  current: RegistryCommunity[],
): LineageReport {
  if (!previous) {
    return { entries: [], trulyLost: [] };
  }
  const currentById = new Map(current.map((c) => [c.id, c]));
  const entries: LineageEntry[] = [];
  const trulyLost: string[] = [];

  for (const before of previous.communities) {
    const id = before.id;
    if (before.deprecated) {
      // Déjà un trou d'une révision antérieure : on le suit, on ne le re-rompt pas.
      entries.push({ id, op: 'unchanged' });
      continue;
    }
    const now = currentById.get(id);
    if (!now || now.deprecated) {
      // Disparue ou dépréciée : la filiation dépend du successeur.
      const target = !now ? undefined : now.replacedBy ?? undefined;
      if (target && currentById.get(target) && !currentById.get(target)!.deprecated) {
        entries.push({ id, op: 'merge', into: target });
      } else {
        trulyLost.push(id);
        entries.push({ id, op: 'move', into: target ?? '' });
      }
      continue;
    }
    // La même identité survit : renommage ? Le libellé a changé.
    const beforeLabel = before.prefLabel;
    const nowLabel = now.prefLabel;
    const sameLabel = Object.keys(beforeLabel).every(
      (lang) => nowLabel[lang] && nowLabel[lang] === beforeLabel[lang],
    );
    if (!sameLabel) entries.push({ id, op: 'rename' });
    else entries.push({ id, op: 'unchanged' });
  }

  // Scissions : des communautés NOUVELLES (aucune identité du précédent) qui
  // se partagent la pierre tombale d'un seul absent commun seraient le signal
  // d'un `split`. On ne l'affecte ici que formellement pour le rapport ; c'est
  // le garde-fou qui tranche de la légitimité.
  return { entries, trulyLost };
}
