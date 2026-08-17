import { memberOverlap, type AnchoredCommunity } from './identity.ts';
import {
  normalizeLabel,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from './schema.ts';

/*
 Hysteresis (D6) and uniqueness (D7).

 Both are decisions of the ENGINE on a model proposal. Donna
 proposes a grouping and names; nothing is applied by the mere fact of having
 been formulated.

 D6 required that the rule become an exact and tested contract rather than an
 intention. The thresholds below are generic and configurable; no
 business vocabulary enters them.
*/

/**
 * Minimal member overlap for a rename to be credible.
 *
 * Below it, the community has changed too much: the new name perhaps describes
 * its current content well, but it is no longer "the same" enough for a
 * reader to recognize the bubble they were following.
 */
export const RENAME_MIN_STABILITY = 0.7;

/**
 * Minimal number of revisions between two renames of the same community.
 *
 * This is the heart of the hysteresis: without it, two successive proposals
 * can make a name oscillate from one revision to the next, and the user loses
 * their mental model of the map. A slightly dated name costs less than an
 * unstable map.
 */
export const RENAME_MIN_REVISION_GAP = 3;

export type ConsolidationOptions = {
  language: string;
  revision: number;
  minStability?: number;
  minRevisionGap?: number;
  /** Forced consolidation: the hysteresis is lifted, never uniqueness. */
  force?: boolean;
};

/**
 * Verdict of the hysteresis on one community, as `synthesizeTaxonomy` publishes
 * it and `wiki taxonomy --apply` prints it.
 *
 * The two constants above are only tunable against observed counts: many `kept`
 * means the model keeps proposing renames the engine refuses, many `renamed`
 * means the map moves under the reader. This type is what makes that
 * measurable — without it, raising a threshold is an impression, not a decision.
 */
export type LabelDecision = {
  id: string;
  label: string;
  /** `kept` when the hysteresis refused the new name. */
  outcome: 'created' | 'renamed' | 'kept' | 'unchanged';
  /** The refused name, kept as an alternate label. Only for `kept`/`renamed`. */
  proposed?: string;
  /** Member overlap that motivated the verdict, against `RENAME_MIN_STABILITY`. */
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
 * Applies the hysteresis then checks uniqueness.
 *
 * Order matters: the hysteresis can KEEP an old name and thus recreate
 * a collision the proposal did not have. Checking uniqueness before
 * would validate a state that will never be the registry's.
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

    // Brand-new community: nothing to stabilize, it takes its name.
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
     An absent language is not a rename, it is a translation.

     The concept did not change identity because it is now displayed in
     English. Applying the hysteresis to it would purely and simply forbid
     adding a language — the fallback to another language would remain displayed
     forever.
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
      // The proposed name is not discarded: it becomes an alternate label, hence
      // consultable and searchable, and the next consolidation will find it again.
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
     The new name first, the old one as alias afterwards.

     `withAltLabel` refuses to add an alias equal to the current label — that is
     what avoids duplicating a name in its own variants. Called before
     the replacement, this guardrail compared the old name to itself and
     therefore dropped it: the rename silently erased the old
     label instead of keeping it.
    */
    const renamed = {
      ...before,
      prefLabel: { ...before.prefLabel, [language]: draft.label },
      changeNote: [...(before.changeNote ?? []), { revision, kind: 'renamed' }],
    };
    return withAltLabel(renamed, language, current);
  });

  /*
   Uniqueness of VISIBLE labels, after hysteresis.

   `scopeNote` does not dispense from it: two bubbles named alike are a map
   defect, whatever their notes say — nobody hovers a bubble to
   lift an ambiguity that the display does not show. The engine never
   invents a suffix: it returns the conflict, and the caller relaunches a bounded
   synthesis with this explicit conflict.
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
