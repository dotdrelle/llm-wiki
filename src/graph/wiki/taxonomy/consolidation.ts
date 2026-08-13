import { memberOverlap, type AnchoredCommunity } from './identity.ts';
import {
  normalizeLabel,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from './schema.ts';

/*
 Hystérésis (D6) et unicité (D7).

 Les deux sont des décisions du MOTEUR sur une proposition du modèle. Donna
 propose un regroupement et des noms ; rien n'est appliqué du seul fait d'avoir
 été formulé.

 D6 exigeait que la règle devienne un contrat exact et testé plutôt qu'une
 intention. Les seuils ci-dessous sont génériques et configurables ; aucun
 vocabulaire métier n'y entre.
*/

/**
 * Recouvrement minimal des membres pour qu'un renommage soit crédible.
 *
 * En dessous, la communauté a trop changé : le nouveau nom décrit peut-être
 * bien son contenu actuel, mais elle n'est plus assez « la même » pour qu'un
 * lecteur reconnaisse la bulle qu'il suivait.
 */
export const RENAME_MIN_STABILITY = 0.7;

/**
 * Nombre minimal de révisions entre deux renommages d'une même communauté.
 *
 * C'est le cœur de l'hystérésis : sans lui, deux propositions successives
 * peuvent faire osciller un nom d'une révision à l'autre, et l'utilisateur perd
 * son modèle mental de la carte. Un nom légèrement daté coûte moins cher qu'une
 * carte instable.
 */
export const RENAME_MIN_REVISION_GAP = 3;

export type ConsolidationOptions = {
  language: string;
  revision: number;
  minStability?: number;
  minRevisionGap?: number;
  /** Consolidation forcée : l'hystérésis est levée, jamais l'unicité. */
  force?: boolean;
};

export type LabelDecision = {
  id: string;
  label: string;
  /** `kept` quand l'hystérésis a refusé le nouveau nom. */
  outcome: 'created' | 'renamed' | 'kept' | 'unchanged';
  proposed?: string;
  stability?: number;
};

export type ConsolidationResult =
  | { ok: true; communities: RegistryCommunity[]; decisions: LabelDecision[] }
  | { ok: false; conflicts: Array<{ label: string; ids: string[] }> };

function lastRenameRevision(community: RegistryCommunity): number {
  const renames = (community.changeNote ?? []).filter((note) => note.kind === 'renamed');
  return renames.length ? renames[renames.length - 1]!.revision : community.firstSeenRevision;
}

function withAltLabel(
  community: RegistryCommunity,
  language: string,
  label: string,
): RegistryCommunity {
  const existing = community.altLabel?.[language] ?? [];
  if (existing.some((item) => normalizeLabel(item) === normalizeLabel(label))) return community;
  if (normalizeLabel(community.prefLabel[language] ?? '') === normalizeLabel(label)) return community;
  return {
    ...community,
    altLabel: { ...(community.altLabel ?? {}), [language]: [...existing, label] },
  };
}

/**
 * Applique l'hystérésis puis vérifie l'unicité.
 *
 * L'ordre compte : l'hystérésis peut CONSERVER un ancien nom et recréer ainsi
 * une collision que la proposition n'avait pas. Vérifier l'unicité avant
 * validerait un état qui ne sera jamais celui du registre.
 */
export function consolidate(
  anchored: AnchoredCommunity[],
  previous: TaxonomyRegistry | null,
  options: ConsolidationOptions,
): ConsolidationResult {
  const { language, revision } = options;
  const minStability = options.minStability ?? RENAME_MIN_STABILITY;
  const minRevisionGap = options.minRevisionGap ?? RENAME_MIN_REVISION_GAP;

  const previousById = new Map((previous?.communities ?? []).map((item) => [item.id, item]));
  const previousMembers = new Map<string, string[]>();
  for (const [page, assignment] of Object.entries(previous?.assignments ?? {})) {
    const list = previousMembers.get(assignment.primaryCommunity) ?? [];
    list.push(page);
    previousMembers.set(assignment.primaryCommunity, list);
  }

  const decisions: LabelDecision[] = [];
  const communities: RegistryCommunity[] = anchored.map((draft) => {
    const before = previousById.get(draft.id);

    // Communauté inédite : rien à stabiliser, elle prend son nom.
    if (!before) {
      decisions.push({ id: draft.id, label: draft.label, outcome: 'created' });
      return {
        id: draft.id,
        prefLabel: { [language]: draft.label },
        firstSeenRevision: revision,
      };
    }

    const current = before.prefLabel[language];

    /*
     Une langue absente n'est pas un renommage, c'est une traduction.

     Le concept n'a pas changé d'identité parce qu'on l'affiche désormais en
     anglais. Lui appliquer l'hystérésis interdirait purement et simplement
     d'ajouter une langue — le repli sur une autre langue resterait affiché
     pour toujours.
    */
    if (current === undefined) {
      decisions.push({ id: draft.id, label: draft.label, outcome: 'created' });
      return {
        ...before,
        prefLabel: { ...before.prefLabel, [language]: draft.label },
      };
    }

    if (normalizeLabel(current) === normalizeLabel(draft.label)) {
      decisions.push({ id: draft.id, label: current, outcome: 'unchanged' });
      return before;
    }

    const stability = memberOverlap(draft.members, previousMembers.get(draft.id) ?? []);
    const settled = revision - lastRenameRevision(before) >= minRevisionGap;
    const accepted = options.force === true || (stability >= minStability && settled);

    if (!accepted) {
      // Le nom proposé n'est pas jeté : il devient un libellé alternatif, donc
      // consultable et cherchable, et la prochaine consolidation le retrouvera.
      decisions.push({
        id: draft.id,
        label: current,
        outcome: 'kept',
        proposed: draft.label,
        stability,
      });
      return withAltLabel(before, language, draft.label);
    }

    decisions.push({
      id: draft.id,
      label: draft.label,
      outcome: 'renamed',
      proposed: draft.label,
      stability,
    });
    /*
     Le nouveau nom d'abord, l'ancien en alias ensuite.

     `withAltLabel` refuse d'ajouter un alias égal au libellé courant — c'est
     ce qui évite de dupliquer un nom dans ses propres variantes. Appelé avant
     le remplacement, ce garde-fou comparait l'ancien nom à lui-même et le
     laissait donc tomber : le renommage effaçait silencieusement l'ancien
     libellé au lieu de le conserver.
    */
    const renamed = {
      ...before,
      prefLabel: { ...before.prefLabel, [language]: draft.label },
      changeNote: [...(before.changeNote ?? []), { revision, kind: 'renamed' }],
    };
    return withAltLabel(renamed, language, current);
  });

  /*
   Unicité des libellés VISIBLES, après hystérésis.

   `scopeNote` n'en dispense pas : deux bulles nommées pareil sont un défaut de
   la carte, quoi que disent leurs notes — personne ne survole une bulle pour
   lever une ambiguïté que l'affichage ne montre pas. Le moteur n'invente
   jamais de suffixe : il rend le conflit, et l'appelant relance une synthèse
   bornée avec ce conflit explicite.
  */
  const byLabel = new Map<string, string[]>();
  for (const community of communities) {
    if (community.deprecated) continue;
    const label = community.prefLabel[language];
    if (!label) continue;
    const key = normalizeLabel(label);
    byLabel.set(key, [...(byLabel.get(key) ?? []), community.id]);
  }
  const conflicts = [...byLabel.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([label, ids]) => ({ label, ids }));

  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true, communities, decisions };
}
