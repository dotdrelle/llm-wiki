import { randomBytes } from 'node:crypto';
import { normalizeLabel } from './schema.ts';
import type { RegistryCommunity, TaxonomyRegistry } from './schema.ts';

/*
 Identité d'une communauté.

 §3.1 du plan laisse ouverte la reproductibilité après reconstruction. Ce
 module ne tranche pas cette décision produit : l'allocateur ci-dessous est le
 mécanisme provisoire du registre courant, pas la garantie contractuelle du lot
 7. Une stratégie reproductible ne doit surtout pas dériver naïvement de la
 liste mutable des membres ; elle peut en revanche reposer sur une source
 d'identité durable ou une sauvegarde du registre.

 Le besoin réel n'est pas « recalculer le même identifiant », c'est « ne pas
 perdre la continuité si le registre est reconstruit ». Cela s'obtient par
 ré-ancrage : on reconnaît une communauté à ses membres et on lui rend son
 ancien identifiant. C'est plus robuste que le déterminisme, parce que ça
 survit aussi à un changement d'algorithme de nommage.
*/

const ID_PREFIX = 'cmty_';

/**
 * Identifiant opaque provisoire, triable par date de création.
 *
 * Les 8 premiers octets encodent l'horodatage : deux identifiants se comparent
 * donc dans leur ordre d'apparition, ce qui rend un `ls` ou un diff de registre
 * lisible sans table de correspondance. Le reste est aléatoire.
 */
export function newCommunityId(now = Date.now()): string {
  const time = now.toString(36).padStart(9, '0');
  return `${ID_PREFIX}${time}${randomBytes(6).toString('hex')}`;
}

export function isCommunityId(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ID_PREFIX) && value.length > ID_PREFIX.length + 8;
}

/**
 * Similarité de Jaccard entre deux ensembles de membres.
 *
 * Une communauté qui gagne ou perd quelques pages reste la même communauté ;
 * une qui a changé de moitié n'en est plus une. Le recouvrement dit précisément
 * cela, et il ne dépend ni du libellé — qui peut avoir été renommé — ni de
 * l'ordre.
 */
export function memberOverlap(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Seuil de reconnaissance. Au-dessus, c'est la même communauté qui continue ;
 * en dessous, c'en est une autre qui occupe le terrain.
 */
export const REANCHOR_MIN_OVERLAP = 0.5;

export type CommunityDraft = { members: string[]; label: string };

export type AnchoredCommunity = {
  id: string;
  members: string[];
  label: string;
  /** Vrai quand l'identifiant vient du registre précédent. */
  reanchored: boolean;
};

/**
 * Rend leur identifiant aux communautés reconnues, en alloue un aux autres.
 *
 * Sans registre précédent — première synthèse, ou registre perdu — tout est
 * neuf et tout reçoit un identifiant. Avec un registre précédent, on apparie
 * par recouvrement de membres, du plus ressemblant au moins ressemblant, chaque
 * ancien identifiant ne pouvant servir qu'une fois : deux communautés issues
 * d'une scission ne peuvent pas revendiquer la même identité.
 */
export function anchorCommunities(
  drafts: CommunityDraft[],
  previous: TaxonomyRegistry | null,
  options: { minOverlap?: number; now?: number } = {},
): AnchoredCommunity[] {
  const minOverlap = options.minOverlap ?? REANCHOR_MIN_OVERLAP;
  const previousMembers = new Map<string, string[]>();
  if (previous) {
    for (const community of previous.communities) {
      if (community.deprecated) continue;
      previousMembers.set(community.id, []);
    }
    for (const [page, assignment] of Object.entries(previous.assignments)) {
      previousMembers.get(assignment.primaryCommunity)?.push(page);
    }
  }

  // Tous les appariements candidats, du meilleur au moins bon. Trier
  // globalement plutôt que de décider draft par draft évite qu'un premier
  // brouillon médiocre s'empare de l'identifiant qu'un suivant mérite mieux.
  const candidates: Array<{ draft: number; id: string; score: number }> = [];
  drafts.forEach((draft, index) => {
    for (const [id, members] of previousMembers) {
      const score = memberOverlap(draft.members, members);
      if (score >= minOverlap) candidates.push({ draft: index, id, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const takenDrafts = new Set<number>();
  const takenIds = new Set<string>();
  const assigned = new Map<number, string>();
  for (const candidate of candidates) {
    if (takenDrafts.has(candidate.draft) || takenIds.has(candidate.id)) continue;
    takenDrafts.add(candidate.draft);
    takenIds.add(candidate.id);
    assigned.set(candidate.draft, candidate.id);
  }

  return drafts.map((draft, index) => {
    const id = assigned.get(index);
    return {
      id: id ?? newCommunityId(options.now),
      members: draft.members,
      label: draft.label,
      reanchored: Boolean(id),
    };
  });
}

/**
 * Rend son identifiant à une communauté préservée que le modèle a redécrite.
 *
 * Le cas apparaît dès qu'une passe de vidange soumet un échantillon DISJOINT du
 * précédent : la communauté d'avant n'a aucune page dans le nouvel échantillon,
 * son recouvrement tombe à zéro, et le modèle — qui ne la voit pas — propose un
 * concept portant exactement le même nom. On obtenait alors deux communautés
 * homonymes dans la même fratrie, ce que le registre refuse à juste titre : la
 * synthèse entière était rejetée, et la vidange ne pouvait jamais se terminer.
 *
 * Le recouvrement de membres ne peut pas trancher ici — il n'y a rien à
 * recouvrir. Mais la contrainte d'unicité du libellé par fratrie dit déjà
 * l'essentiel : deux sœurs de même nom sont la même chose. On reconnaît donc la
 * communauté à son nom, dans sa fratrie, et seulement pour un brouillon qui n'a
 * été ré-ancré par aucun membre.
 */
export function adoptByLabel(
  drafts: AnchoredCommunity[],
  preserved: Array<{ id: string; label: string }>,
): { communities: AnchoredCommunity[]; adopted: Set<string> } {
  // `normalizeLabel` porte déjà la règle d'égalité visible du registre. En
  // dupliquer une variante ici, c'est se condamner à ce que les deux divergent :
  // l'adoption cesserait alors de reconnaître exactement les homonymes que la
  // validation refuse.
  const available = new Map<string, string>();
  for (const community of preserved) {
    const key = normalizeLabel(community.label);
    if (!available.has(key)) available.set(key, community.id);
  }
  const adopted = new Set<string>();
  const communities = drafts.map((draft) => {
    if (draft.reanchored) return draft;
    const id = available.get(normalizeLabel(draft.label));
    if (!id || adopted.has(id)) return draft;
    adopted.add(id);
    return { ...draft, id, reanchored: true };
  });
  return { communities, adopted };
}

/**
 * Marque comme dépréciées les communautés du registre précédent qui n'ont pas
 * survécu, en les pointant vers leur remplaçante quand il y en a une.
 *
 * Elles ne sont **jamais supprimées** : c'est ce qui rend la convergence
 * visuelle d'une fusion et le remap d'une sélection résolubles indéfiniment,
 * y compris pour un client qui revient avec un identifiant ancien.
 */
/**
 * Membres d'une communauté, **descendants compris**.
 *
 * Le registre n'assigne une page qu'à une feuille : un domaine ne figure dans
 * aucune valeur de `assignments`. Compter ses membres à partir des seules
 * assignations directes lui en donnait donc zéro — alors qu'il en a par
 * définition plus qu'aucune de ses filles. Tout raisonnement par recouvrement
 * portant sur un domaine renvoyait ainsi systématiquement 0, et la redirection
 * qui en dépend tombait sur un repli arbitraire.
 *
 * Une feuille n'a pas de descendant : pour elle, le résultat est inchangé.
 */
export function membersByCommunity(registry: TaxonomyRegistry): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const community of registry.communities) members.set(community.id, []);
  const parentOf = new Map(
    registry.communities.map((community) => [community.id, community.parentCommunity ?? null] as const),
  );
  for (const [page, assignment] of Object.entries(registry.assignments)) {
    let current: string | null | undefined = assignment.primaryCommunity;
    // La profondeur est bornée par le schéma ; la garde protège d'un registre
    // corrompu en cycle plutôt que de faire tourner la boucle indéfiniment.
    for (let hops = 0; current && hops < 8; hops += 1) {
      members.get(current)?.push(page);
      current = parentOf.get(current) ?? null;
    }
  }
  return members;
}

export function deprecateMissing(
  previous: TaxonomyRegistry | null,
  survivors: AnchoredCommunity[],
  revision: number,
): RegistryCommunity[] {
  if (!previous) return [];
  const alive = new Set(survivors.map((community) => community.id));
  const previousMembers = membersByCommunity(previous);

  return previous.communities
    .filter((community) => !alive.has(community.id) && !community.deprecated)
    .map((community) => {
      // Vers qui sont partis ses membres ? La communauté qui en a récupéré le
      // plus est la cible naturelle de la fusion.
      const members = previousMembers.get(community.id) ?? [];
      let best: { id: string; score: number } | null = null;
      for (const survivor of survivors) {
        const score = memberOverlap(members, survivor.members);
        if (score > 0 && (!best || score > best.score)) best = { id: survivor.id, score };
      }
      /*
       Aucun recouvrement : la cible de repli mentait.

       Le repli était `survivors[0]` — la première communauté de la liste, qui
       n'a aucun rapport avec la disparue. Une sélection restaurée y atterrissait
       en silence, et la note de changement écrite juste en dessous disait
       « removed » pendant que `replacedBy` désignait quelqu'un : le registre se
       contredisait lui-même.

       La communauté la plus proche par la STRUCTURE est alors le meilleur
       candidat honnête — le parent survivant, qui contenait bien ses pages. À
       défaut, il n'y a pas de successeur, et c'est ce qu'il faut dire.
      */
      const survivingParent = community.parentCommunity && alive.has(community.parentCommunity)
        ? community.parentCommunity
        : null;
      const replacedBy = best?.id ?? survivingParent ?? community.replacedBy ?? null;
      return {
        ...community,
        deprecated: true,
        replacedBy,
        changeNote: [
          ...(community.changeNote ?? []),
          { revision, kind: best ? 'merged' : replacedBy ? 'reparented' : 'removed', from: [community.id] },
        ],
      };
    });
}
