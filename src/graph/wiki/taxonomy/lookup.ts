import { communityId, type RegistryLookup } from '../communityProjection.ts';
import { communityLabel, resolveCommunity, type TaxonomyRegistry } from './schema.ts';

/**
 * Adapte un registre à la vue minimale dont l'affectation a besoin.
 *
 * C'est ici, et seulement ici, que le vocabulaire du registre redevient le
 * couple `(id, label)` que le snapshot expose. La projection reste ignorante
 * de SKOS, des langues et des révisions ; le registre reste ignorant du graphe.
 *
 * Les absorptions sont résolues au passage : une affectation qui pointe encore
 * un concept fusionné rend la communauté ACTIVE, jamais une bulle disparue.
 * C'est ce qui permet à un registre légèrement en retard sur ses propres
 * fusions de rester lisible plutôt que de faire disparaître des pages.
 */
export function registryLookup(
  registry: TaxonomyRegistry,
  language: string,
  fallbackLanguage = 'en',
): RegistryLookup {
  const resolved = new Map<string, { communityId: string; communityLabel: string }>();

  for (const [page, assignment] of Object.entries(registry.assignments)) {
    const community = resolveCommunity(registry, assignment.primaryCommunity);
    if (!community || community.deprecated) continue;
    resolved.set(page, {
      communityId: community.id,
      communityLabel: communityLabel(community, language, fallbackLanguage),
    });
  }

  return { assign: (pageId) => resolved.get(pageId) ?? null };
}

export type CommunityDomain = { id: string; label: string };
export type CommunityHierarchy = {
  /** Domaines racines : ce que la carte affiche au premier niveau. */
  domains: CommunityDomain[];
  /** Feuille → domaine. Vide quand la taxonomie est encore plate. */
  parents: Record<string, string>;
};

/**
 * Arbre des communautés, tel que l'écran doit le parcourir.
 *
 * Le registre porte la hiérarchie, mais un nœud du graphe ne connaît que sa
 * feuille : c'est le niveau qui porte les pages. Sans cette table, la carte
 * afficherait les feuilles — donc autant de bulles qu'il y a de sujets — au
 * lieu des quelques domaines qu'elle est censée montrer.
 *
 * Elle est vide sur une taxonomie déterministe : la carte retombe alors sur
 * son rendu plat, ce qui est le comportement correct tant qu'aucun domaine
 * n'existe.
 */
export function communityHierarchy(
  registry: TaxonomyRegistry,
  language: string,
  fallbackLanguage = 'en',
): CommunityHierarchy {
  const active = registry.communities.filter((community) => !community.deprecated);
  const byId = new Map(active.map((community) => [community.id, community]));
  const parents: Record<string, string> = {};
  const used = new Set<string>();

  for (const community of active) {
    if (!community.parentCommunity) continue;
    const domain = byId.get(community.parentCommunity);
    if (!domain) continue;
    parents[community.id] = domain.id;
    used.add(domain.id);
  }

  return {
    // Seuls les domaines qui portent réellement des communautés : une racine
    // sans enfant est une feuille, et elle s'affiche comme telle.
    domains: active
      .filter((community) => used.has(community.id))
      .map((community) => ({ id: community.id, label: communityLabel(community, language, fallbackLanguage) })),
    parents,
  };
}

/**
 * Redirections d'identifiants, de l'absorbé vers l'actif.
 *
 * Le client s'en sert pour deux choses qui seraient sinon des pertes visibles :
 * suivre une sélection à travers une fusion, et retrouver la position Canvas
 * enregistrée sous l'ancien identifiant.
 */
export function communityRedirects(registry: TaxonomyRegistry): Record<string, string> {
  const redirects: Record<string, string> = {};
  for (const community of registry.communities) {
    if (!community.deprecated) continue;
    const target = resolveCommunity(registry, community.id);
    if (target && target.id !== community.id) redirects[community.id] = target.id;
  }
  // Première activation du registre : les positions historiques sont encore
  // indexées par le slug dérivé du libellé déterministe. Elles doivent suivre
  // le nouvel id opaque exactement comme une fusion ultérieure. En cas de
  // collision multilingue, aucune migration ambiguë n'est inventée.
  const legacyOwners = new Map<string, string | null>();
  for (const community of registry.communities) {
    if (community.deprecated) continue;
    const labels = [
      ...Object.values(community.prefLabel),
      ...Object.values(community.altLabel ?? {}).flat(),
    ];
    for (const label of labels) {
      const legacy = communityId(label);
      const previous = legacyOwners.get(legacy);
      legacyOwners.set(legacy, previous === undefined || previous === community.id ? community.id : null);
    }
  }
  for (const [legacy, owner] of legacyOwners) {
    if (owner && legacy !== owner && redirects[legacy] === undefined) redirects[legacy] = owner;
  }
  return redirects;
}
