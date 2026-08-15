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
      const target = !now ? undefined : (now.replacedBy ?? undefined);
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

  return { entries, trulyLost };
}

/**
 * Règle STABLE et déterministe de choix du survivant d'une fusion (§6.3).
 *
 * « Le survivant qui porte le nom le plus parlant » n'a aucune place ici : une
 * identité de carte se reconnaît à sa continuité, pas à un libellé du brouillon.
 * La règle est donc purement mécanique et reproductible à chaque appel sur le
 * même registre.
 *
 * Survit la communauté la plus ANCIENNE (`firstSeenRevision` minimal) — celle
 * que les lecteurs reconnaissent depuis le plus longtemps ; à âges égaux,
 * l'identifiant lexicographique le plus petit départage. Ni le label, ni le
 * nombre de pages, ni la position dans la liste n'entrent en compte.
 */
export function pickSurvivor(candidates: RegistryCommunity[]): string | null {
  if (candidates.length === 0) return null;
  // `candidates` non vide garantit qu'au moins une itération affecte survivor,
  // donc l'assertion non-nulle ci-dessous est sûre.
  let survivor: RegistryCommunity = candidates[0]!;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const candidateAge = candidate.firstSeenRevision;
    const survivorAge = survivor.firstSeenRevision;
    if (
      candidateAge < survivorAge ||
      (candidateAge === survivorAge && candidate.id < survivor.id)
    ) {
      survivor = candidate;
    }
  }
  return survivor.id;
}

/**
 * Rédige la souche dépréciée d'une communauté absorbée par une fusion (§6.3).
 *
 * Une identité absorbée n'est jamais supprimée : elle reste dans le registre,
 * passe `deprecated: true` et renvoie `replacedBy` vers le survivant, et le
 * survivant l'inscrit dans `replaces` — c'est ce qui permet à
 * `resolveCommunity` et aux rapports avant/après de relire la redirection.
 * Ne mute jamais `current` ; retourne une nouvelle liste.
 *
 * Refuse les redirections qui effaceraient une identité : une cible absente,
 * déjà dépréciée, ou la communauté elle-même ne produit aucune souche.
 */
export function deprecateInto(
  current: RegistryCommunity[],
  args: { id: string; replacedBy: string; revision: number },
): RegistryCommunity[] {
  if (args.replacedBy === args.id) return current;
  const survivor = current.find((c) => c.id === args.replacedBy);
  if (!survivor || survivor.deprecated) return current;

  return current.map((community) => {
    if (community.id === args.id && !community.deprecated) {
      return {
        ...community,
        deprecated: true,
        replacedBy: args.replacedBy,
        changeNote: [
          ...(community.changeNote ?? []),
          { revision: args.revision, kind: 'deprecated', from: [args.replacedBy] },
        ],
      };
    }
    if (community.id === args.replacedBy) {
      const already = (community.replaces ?? []).includes(args.id);
      if (already) return community;
      return {
        ...community,
        replaces: [...(community.replaces ?? []), args.id],
      };
    }
    return community;
  });
}

export type LineageSummary = {
  /** Identités conservées telles quelles. */
  unchanged: string[];
  /** Identités conservées sous un libellé différent. */
  renamed: string[];
  /** Absorbées vers un survivant. */
  merged: Array<{ id: string; into: string }>;
  /** Une ascendante partagée, repartie entre plusieurs branches nouvelles. */
  split: Array<{ from: string; branches: string[] }>;
  /** Déplacées vers une cible (dépréciation filiée au sens strict). */
  moved: Array<{ id: string; into: string }>;
  /** Souches dépréciées de la révision, avec leur successeur éventuel. */
  deprecated: Array<{ id: string; into: string | null }>;
  /** Communautés vivantes nées dans cette révision, hors scissions. */
  created: string[];
  /** Disparues sans aucun successeur filié : trous de la carte. */
  trulyLost: string[];
};

/**
 * Rapport avant/après de la révision, en catégories (§6.3).
 *
 * Déduit fusions et scissions du MOUVEMENT DES PAGES, jamais d'un inventaire
 * nommé : ce sont les pages qui portent la continuité, et les deux registres
 * (le `assignments` du précédent et du courant) suffisent à retracer où chaque
 * page a atterri. Une communauté disparue dont toutes les pages migrent vers un
 * seul survivant est une fusion ; réparties entre plusieurs survivants, une
 * scission. Une page qui change de feuille sans que sa communauté d'origine
 * disparaisse est un déplacement.
 *
 * Requiert le registre courant COMPLET (`assignments` compris) pour retracer le
 * mouvement — contrairement à `lineageReport` qui ne compare que des
 * communautés.
 */
export function summarizeLineage(
  previous: TaxonomyRegistry | null,
  current: TaxonomyRegistry,
): LineageSummary {
  const communities = current.communities;
  if (!previous) {
    return {
      unchanged: [],
      renamed: [],
      merged: [],
      split: [],
      moved: [],
      deprecated: [],
      created: communities.filter((c) => !c.deprecated).map((c) => c.id),
      trulyLost: [],
    };
  }

  const currentById = new Map(communities.map((c) => [c.id, c]));

  // Page -> communauté vivante du registre courant, en suivant les dépréciations
  // de la DESTINATION (comme le ferait un lecteur de la carte).
  const endsAtLive = (id: string): string | null => {
    let cursor: string | null = id;
    const seen = new Set<string>();
    for (let hops = 0; cursor && !seen.has(cursor) && hops < 16; hops += 1) {
      seen.add(cursor);
      const entry = currentById.get(cursor);
      if (!entry) return null;
      if (entry.deprecated) {
        cursor = entry.replacedBy ?? null;
        continue;
      }
      return entry.id;
    }
    return null;
  };
  // Pour chaque page : sa communauté d'origine (dans `previous`) et celle où
  // elle atterrit (dans `current`, résolue vers une feuille vivante).
  const pageFrom = new Map<string, string>();
  const pagesTo = new Map<string, string[]>();
  for (const [page, assignment] of Object.entries(previous.assignments)) {
    pageFrom.set(page, assignment.primaryCommunity);
  }
  for (const [page, assignment] of Object.entries(current.assignments)) {
    const from = pageFrom.get(page);
    if (!from) continue;
    const to = endsAtLive(assignment.primaryCommunity);
    if (!to) continue;
    const list = pagesTo.get(to) ?? [];
    list.push(page);
    pagesTo.set(to, list);
  }

  const unchanged: string[] = [];
  const renamed: string[] = [];
  const merged: Array<{ id: string; into: string }> = [];
  const moved: Array<{ id: string; into: string }> = [];
  const deprecated: Array<{ id: string; into: string | null }> = [];
  const trulyLost: string[] = [];
  const splitByFrom = new Map<string, string[]>();

  for (const before of previous.communities) {
    if (before.deprecated) continue;
    const id = before.id;
    const now = currentById.get(id);

    if (now && !now.deprecated) {
      const beforeLabel = before.prefLabel;
      const nowLabel = now.prefLabel;
      const same = Object.keys(beforeLabel).every(
        (lang) => nowLabel[lang] && nowLabel[lang] === beforeLabel[lang],
      );
      if (same) unchanged.push(id);
      else renamed.push(id);
      continue;
    }

    // Communauté disparue (ou dépréciée) : où sont passées ses pages ?
    const descendants = new Set<string>();
    for (const [to, pages] of pagesTo) {
      for (const page of pages) {
        if (pageFrom.get(page) === id) descendants.add(to);
      }
    }
    const named = [...descendants].filter((target) => target !== id);

    if (now?.deprecated && named.length === 0) {
      // Dépréciée explicitement vers un survivant, sans migration de pages
      // observée : on suit la redirection déclarée elle-même.
      const declared = endsAtLive(now.replacedBy ?? '');
      if (declared) merged.push({ id, into: declared });
      else {
        deprecated.push({ id, into: now.replacedBy ?? null });
        if (!now.replacedBy) trulyLost.push(id);
      }
      continue;
    }

    if (named.length === 1) {
      merged.push({ id, into: named[0]! });
      continue;
    }
    if (named.length >= 2) {
      // Scission : plusieurs feuilles reprennent les pages d'une même source.
      for (const branch of named) {
        splitByFrom.set(id, [...(splitByFrom.get(id) ?? []), branch]);
      }
      continue;
    }

    // Aucune page migrée observable : vraie disparition ou déplacement sans
    // continuation. Si aucun successeur explicite n'existe, c'est un trou.
    deprecated.push({ id, into: now?.replacedBy ?? null });
    if (!now?.replacedBy) trulyLost.push(id);
  }

  const split: Array<{ from: string; branches: string[] }> = [];
  for (const [from, branches] of splitByFrom) {
    if (branches.length >= 2)
      split.push({ from, branches: [...new Set(branches)].sort() });
  }
  const splitIds = new Set(split.flatMap((entry) => entry.branches));

  const builtBefore = new Set(
    previous.communities.filter((c) => !c.deprecated).map((c) => c.id),
  );
  const created = communities
    .filter((c) => !c.deprecated && !builtBefore.has(c.id) && !splitIds.has(c.id))
    .map((c) => c.id);

  trulyLost.sort();
  return {
    unchanged: unchanged.sort(),
    renamed: renamed.sort(),
    merged: merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    split,
    moved: moved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    deprecated: deprecated.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    created: created.sort(),
    trulyLost,
  };
}
