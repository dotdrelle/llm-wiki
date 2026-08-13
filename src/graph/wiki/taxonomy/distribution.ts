import type { TaxonomyRegistry } from './schema.ts';

/*
 Contrôle de distribution, avant publication.

 La révision qui a fusionné 142 pages dans une seule bulle était
 STRUCTURELLEMENT valide : identifiants cohérents, libellés conformes,
 couverture complète. Elle était fonctionnellement inutilisable. Un registre
 peut donc passer toutes les vérifications de forme et détruire la navigation,
 ce qui veut dire qu'il manquait un contrôle — celui de la forme de la
 distribution, pas de celle des données.
*/

/**
 * Part maximale du corpus qu'une communauté feuille peut porter.
 *
 * Au-delà, ce n'est plus un sujet : c'est le corpus avec un nom dessus. Le
 * seuil est relatif pour rester valable d'un wiki de 50 pages à un wiki de
 * 5 000, et il s'accompagne d'un plancher absolu pour ne pas déclarer
 * « démesurée » une feuille de 6 pages dans un corpus de 10.
 */
export const MAX_LEAF_SHARE = 0.35;
export const LEAF_SHARE_FLOOR = 12;

/**
 * Un domaine qui n'a qu'une communauté fille ajoute un niveau de navigation
 * pour ne rien séparer : deux clics au lieu d'un, sans information gagnée.
 */
export const MIN_CHILDREN_PER_DOMAIN = 2;

export type DistributionIssue = { code: string; reason: string };
export type DistributionReport = {
  ok: boolean;
  issues: DistributionIssue[];
  pageCount: number;
  domains: number;
  leaves: number;
  /** Taille de la plus grosse feuille, en pages. */
  largestLeaf: number;
};

/**
 * Juge la forme d'une taxonomie : profondeur, tailles, absence de fourre-tout.
 *
 * Ce contrôle est distinct de la validation de schéma parce qu'il répond à une
 * autre question. La validation demande « ce registre est-il cohérent ? » ; ce
 * rapport demande « cette carte est-elle navigable ? ». Les deux doivent passer
 * avant publication.
 */
export function checkDistribution(registry: TaxonomyRegistry): DistributionReport {
  const issues: DistributionIssue[] = [];
  const active = registry.communities.filter((community) => !community.deprecated);
  const children = new Map<string, number>();
  for (const community of active) {
    if (community.parentCommunity) {
      children.set(community.parentCommunity, (children.get(community.parentCommunity) ?? 0) + 1);
    }
  }

  const sizes = new Map<string, number>();
  for (const assignment of Object.values(registry.assignments)) {
    sizes.set(assignment.primaryCommunity, (sizes.get(assignment.primaryCommunity) ?? 0) + 1);
  }
  const pageCount = Object.keys(registry.assignments).length;
  const leaves = active.filter((community) => !children.has(community.id));
  const domains = active.filter((community) => children.has(community.id));

  const cap = Math.max(LEAF_SHARE_FLOOR, Math.ceil(pageCount * MAX_LEAF_SHARE));
  let largestLeaf = 0;
  for (const leaf of leaves) {
    const size = sizes.get(leaf.id) ?? 0;
    largestLeaf = Math.max(largestLeaf, size);
    if (size > cap) {
      issues.push({
        code: 'leaf_too_large',
        reason: `${leaf.id} porte ${size} page(s) sur ${pageCount} (maximum ${cap}) : c'est un fourre-tout, pas un sujet`,
      });
    }
  }

  for (const domain of domains) {
    const count = children.get(domain.id) ?? 0;
    if (count < MIN_CHILDREN_PER_DOMAIN) {
      issues.push({
        code: 'domain_too_thin',
        reason: `${domain.id} n'a que ${count} communauté(s) fille(s) : un niveau de navigation pour rien`,
      });
    }
  }

  // Une taxonomie entièrement plate est exactement le défaut d'origine : elle
  // peut être légitime sur un très petit corpus, jamais au-delà.
  if (!domains.length && pageCount > cap) {
    issues.push({
      code: 'no_hierarchy',
      reason: `aucun domaine parent pour ${pageCount} page(s) : la carte ne peut pas être parcourue par niveaux`,
    });
  }

  // Une feuille vide n'apparaîtra jamais : elle encombre l'index et laisse
  // croire à un sujet qui n'existe pas.
  for (const leaf of leaves) {
    if (!(sizes.get(leaf.id) ?? 0)) {
      issues.push({ code: 'empty_leaf', reason: `${leaf.id} ne porte aucune page` });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    pageCount,
    domains: domains.length,
    leaves: leaves.length,
    largestLeaf,
  };
}
