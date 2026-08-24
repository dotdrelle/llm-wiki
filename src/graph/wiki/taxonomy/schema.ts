/*
 Taxonomy registry schema — vocabulary inspired by SKOS.

 The registry reuses field names and a few rules from a thesaurus
 (`prefLabel` indexed by language, `altLabel`, `scopeNote`) without claiming to be a
 full SKOS model: `replaces`, `replacedBy`, `deprecated`, `changeNote` and
 `primaryCommunity` are local extensions, and the uniqueness of the visible label
 is a constraint of the map, not of the standard.

 None of this leaves here: the snapshot always exposes `label` as a
 string, derived at read time.
*/

/**
 * Schema version. A registry of another version is ignored, never
 * reinterpreted.
 *
 * v3 adds the **coverage proof**: `corpusPageIds`, `sampledPageIds` and
 * the fingerprint algorithm. Without them, a page absent from `assignments` is
 * indistinguishable between three causes — never submitted to the model, submitted and not
 * classified, or appeared after synthesis. That is exactly the ambiguity that had
 * made a revision gap pass for 130 "unclassified" pages.
 *
 * A v2 registry remains readable as a historical artifact but proves no
 * coverage: its pages are presented as pending until the first
 * v3 publication.
 */
export const REGISTRY_SCHEMA_VERSION = 3;

/**
 * Maximum depth of the tree: domain → community → pages.
 *
 * Graph navigation is `map → domain → community → document`. A
 * third community level would have no rendering and would make the map
 * unreadable before being useful; it will be added the day a screen expresses it.
 */
export const MAX_COMMUNITY_DEPTH = 2;

export type LocalizedText = Record<string, string>;
export type LocalizedList = Record<string, string[]>;

export type RegistryCommunity = {
  id: string;
  /**
   * Parent domain, or `null`/absent for a root domain.
   *
   * v1 was flat, and that is what produced a catch-all: the model
   * had no way to express "these five products are five distinct
   * subjects that fall under the same domain". Reducing the number of bubbles
   * could therefore only aggregate, and aggregating destroys navigation.
   */
  parentCommunity?: string | null;
  /** At most one value per language. That is what makes a language change cheap. */
  prefLabel: LocalizedText;
  altLabel?: LocalizedList;
  scopeNote?: LocalizedText;
  /** Concepts absorbed by this one. Local extension. */
  replaces?: string[];
  /** Set when THIS concept was absorbed. The entry is never deleted. */
  replacedBy?: string | null;
  deprecated?: boolean;
  firstSeenRevision: number;
  changeNote?: Array<{ revision: number; kind: string; from?: string[] }>;
};

export type RegistryAssignment = {
  /**
   * Home community, necessarily a **leaf**.
   *
   * A page is never attached directly to a domain: the domain
   * aggregates its leaves, it does not replace them. That is what guarantees that a
   * click on a domain opens its communities and not a list of 142
   * documents.
   */
  primaryCommunity: string;
  /**
   * Secondary facets, with an explicit semantics: "related to", never
   * "belongs to".
   *
   * A page about one product's security primarily belongs to that product;
   * putting it under Security would make it disappear from its product, and duplicating it
   * would falsify every count. These links therefore drive no placement:
   * they enrich reading and search.
   */
  relatedCommunities?: string[];
};

export type TaxonomyRegistry = {
  schemaVersion: number;
  revision: number;
  corpus: string;
  /**
   * Algorithm that produced `corpus`. Two fingerprints from different algorithms
   * do not compare — saying so avoids turning an incomparability into
   * staleness.
   */
  corpusAlgorithm: string;
  languages: string[];
  communities: RegistryCommunity[];
  /** Page path relative to the workspace → assignment. */
  assignments: Record<string, RegistryAssignment>;
  /**
   * All knowledge pages of the corpus at synthesis time.
   *
   * This is the denominator of coverage. It lives in the published registry, and
   * not only in the transient inventory, because a reader that loads
   * marker + registry must be able to compute the states without replaying the
   * synthesis — that is, without calling a model.
   */
  corpusPageIds: string[];
  /**
   * Pages actually submitted to the model, accumulated over the passes of a single
   * corpus fingerprint.
   *
   * A corpus page absent from here was never judged: counting it as
   * "unclassified" would accuse the synthesis of a sampling decision
   * taken upstream.
   */
  sampledPageIds: string[];
};

export type ValidationIssue = { path: string; reason: string };
export type ValidationResult =
  | { ok: true; registry: TaxonomyRegistry }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Normalized form of a label for uniqueness comparison.
 *
 * `Solution`, `solution` and `Sólution` are the same word on a reader's screen;
 * treating them as distinct would let through exactly the duplicate that D7
 * forbids.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * A visible label is a word or a short phrase, without a path.
 *
 * `/` and `_` are excluded explicitly because they are the two ways a model
 * spits out a folder hierarchy as a name. A space is allowed so a subject can
 * be named by a short phrase ("sécurité info") instead of a glued word
 * ("securiteinfo"), but the phrase is bounded so a bubble stays readable.
 */
export const MAX_LABEL_WORDS = 2;
export const MAX_LABEL_CHARS = 48;

/**
 * Why a label fails the shape check, or `undefined` when it passes.
 *
 * A caller that only learns "invalid label" (the former shape of
 * `isValidLabel`) cannot act on it — a taxonomy-synthesis retry that repeats
 * "invalid domain label: X" without saying too many words vs. too long vs. a
 * forbidden character just gets the same kind of violation back. Kept as the
 * one place the bound is checked; `isValidLabel` below is a thin wrapper.
 */
export function labelShapeIssue(label: string): string | undefined {
  if (typeof label !== 'string') return 'label is not a string';
  const trimmed = label.trim();
  if (!trimmed) return 'label is empty';
  if (trimmed !== label) return 'label has leading or trailing whitespace';
  if (/[/_\\]/.test(trimmed)) return 'label contains a forbidden character (/, _ or \\)';
  if (trimmed.length > MAX_LABEL_CHARS) {
    return `label is ${trimmed.length} characters, limit is ${MAX_LABEL_CHARS}`;
  }
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > MAX_LABEL_WORDS) {
    return `label has ${wordCount} words ("${trimmed}"), limit is ${MAX_LABEL_WORDS}`;
  }
  return undefined;
}

export function isValidLabel(label: string): boolean {
  return labelShapeIssue(label) === undefined;
}

/*
 * Labels that name the page SCOPE or a catch-all, not a subject.

 * They are the first thing a model falls back to when it does not really
 * group ("Product" with 48 pages, "Transverse", "Ungrouped"). The prompt
 * forbids them; the prompt is not enough — a model that ignores it publishes
 * a map that only re-states how pages were produced. Enforced in code so the
 * proposal is rejected and re-synthesized instead of published.
 */
const FORBIDDEN_TAXONOMY_LABELS = new Set([
  // scope words: how pages were produced or sorted, not what they are about.
  'source', 'product', 'products', 'produit', 'produits',
  'transverse', 'transversal', 'workspace', 'espace de travail', 'espace',
  // catch-all labels.
  'divers', 'diverses', 'diverse', 'various', 'misc', 'miscellaneous',
  'other', 'others', 'autre', 'autres', 'unclassified', 'ungrouped',
  'non classe', 'non groupe', 'inclasses', 'inclassé',
]);

export function forbiddenLabelReason(label: string): string | undefined {
  const normalized = normalizeLabel(label);
  return FORBIDDEN_TAXONOMY_LABELS.has(normalized)
    ? `label names a page scope or a catch-all, not a subject: "${label}"`
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateLocalizedText(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { labels = false }: { labels?: boolean } = {},
): void {
  if (!isPlainObject(value)) {
    issues.push({ path, reason: 'expected: object indexed by language' });
    return;
  }
  for (const [language, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !text.trim()) {
      issues.push({ path: `${path}.${language}`, reason: 'empty or non-textual text' });
      continue;
    }
    if (labels && !isValidLabel(text)) {
      issues.push({ path: `${path}.${language}`, reason: `invalid label: "${text}"` });
    }
  }
}

/**
 * Validates a registry **as a whole**.
 *
 * A non-conforming proposal is rejected entirely, never repaired silently
 * nor applied partially: a half-applied registry would produce a
 * map that nobody decided, and from which one could no longer say what it
 * derives from.
 */
export function validateRegistry(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: '', reason: 'registry absent or not an object' }] };
  }

  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    // A registry of another version is ignored, not reinterpreted: guessing the
    // semantics of an unknown format is the surest way to corrupt.
    return {
      ok: false,
      issues: [{ path: 'schemaVersion', reason: `expected ${REGISTRY_SCHEMA_VERSION}, got ${String(value.schemaVersion)}` }],
    };
  }
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0) {
    issues.push({ path: 'revision', reason: 'positive integer expected' });
  }
  if (typeof value.corpus !== 'string' || !value.corpus) {
    issues.push({ path: 'corpus', reason: 'missing corpus fingerprint' });
  }
  if (typeof value.corpusAlgorithm !== 'string' || !value.corpusAlgorithm) {
    issues.push({ path: 'corpusAlgorithm', reason: 'missing fingerprint algorithm' });
  }
  for (const field of ['corpusPageIds', 'sampledPageIds'] as const) {
    const list = value[field];
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !item)) {
      issues.push({ path: field, reason: 'list of page paths expected' });
    }
  }
  /*
   The sample is a subset of the corpus, never the reverse.

   A page submitted but absent from the corpus would make coverage incalculable:
   it would be neither classified, nor pending, nor outside the sample. Better to
   reject the registry than to publish a map whose counters do not add
   up.
  */
  if (Array.isArray(value.corpusPageIds) && Array.isArray(value.sampledPageIds)) {
    const corpus = new Set(value.corpusPageIds.map(String));
    const stray = value.sampledPageIds.map(String).filter((page) => !corpus.has(page));
    if (stray.length) {
      issues.push({
        path: 'sampledPageIds',
        reason: `${stray.length} page(s) sampled outside the declared corpus`,
      });
    }
  }
  if (!Array.isArray(value.languages) || value.languages.some((item) => typeof item !== 'string')) {
    issues.push({ path: 'languages', reason: 'list of languages expected' });
  }
  if (!Array.isArray(value.communities)) {
    issues.push({ path: 'communities', reason: 'list expected' });
    return { ok: false, issues };
  }

  const ids = new Set<string>();
  /*
   Uniqueness of the visible label, per language and **per sibling group**.

   v1 imposed global uniqueness, because a flat map displays everything at
   once. A tree never shows more than the roots, then the
   children of a single domain: two "Reporting" under two distinct domains
   therefore never meet on screen. Keeping the global rule
   would forbid perfectly legitimate names and push the model towards
   compound labels — that is, towards what the single-word rule
   seeks to avoid.

   Roots are siblings of each other, under the empty key.
  */
  const labelsBySibling = new Map<string, Map<string, string>>();
  const parentOf = new Map<string, string | null>();

  for (const [index, community] of value.communities.entries()) {
    const at = `communities[${index}]`;
    if (!isPlainObject(community)) {
      issues.push({ path: at, reason: 'object expected' });
      continue;
    }
    const id = community.id;
    if (typeof id !== 'string' || !id) {
      issues.push({ path: `${at}.id`, reason: 'missing identifier' });
    } else if (ids.has(id)) {
      issues.push({ path: `${at}.id`, reason: `duplicate identifier: ${id}` });
    } else {
      ids.add(id);
    }

    validateLocalizedText(community.prefLabel, `${at}.prefLabel`, issues, { labels: true });
    if (community.altLabel !== undefined) {
      if (!isPlainObject(community.altLabel)) {
        issues.push({ path: `${at}.altLabel`, reason: 'object indexed by language expected' });
      } else {
        for (const [language, list] of Object.entries(community.altLabel)) {
          if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
            issues.push({ path: `${at}.altLabel.${language}`, reason: 'list of strings expected' });
          }
        }
      }
    }
    if (community.scopeNote !== undefined) {
      validateLocalizedText(community.scopeNote, `${at}.scopeNote`, issues);
    }
    if (typeof community.firstSeenRevision !== 'number') {
      issues.push({ path: `${at}.firstSeenRevision`, reason: 'missing first-seen revision' });
    }

    /*
     A deprecated concept WITHOUT a replacement is legitimate.

     The rule required a successor, on the grounds that a restored selection would
     "have nowhere to go". That is false: `resolveCommunity` stops on a
     null `replacedBy` and returns the deprecated concept itself, which the client knows
     how to present as gone.

     Requiring a successor had, however, a very real consequence: when
     no surviving community took over the pages, one had to
     invent one, and the code fell back on the first in the list. A reader
     who came back with an old identifier therefore landed silently in
     an unrelated community. A false redirection is worse than an absence
     of redirection: the latter is visible, the former is not.
    */
    const deprecated = community.deprecated === true;
    const parent = community.parentCommunity == null ? null : String(community.parentCommunity);
    if (typeof id === 'string' && id) parentOf.set(id, parent);
    if (!deprecated && isPlainObject(community.prefLabel)) {
      for (const [language, text] of Object.entries(community.prefLabel)) {
        if (typeof text !== 'string') continue;
        const scope = `${language}\u001f${parent ?? ''}`;
        const seen = labelsBySibling.get(scope) ?? new Map<string, string>();
        const key = normalizeLabel(text);
        const owner = seen.get(key);
        if (owner && owner !== id) {
          issues.push({
            path: `${at}.prefLabel.${language}`,
            reason: `duplicate visible label with ${owner} in the same sibling group: "${text}"`,
          });
        }
        seen.set(key, typeof id === 'string' ? id : at);
        labelsBySibling.set(scope, seen);
      }
    }
  }

  // Tree: known AND live parent, no cycle, bounded depth.
  const deprecatedIds = new Set(
    value.communities
      .filter((community): community is Record<string, unknown> => isPlainObject(community))
      .filter((community) => community.deprecated === true && typeof community.id === 'string')
      .map((community) => String(community.id)),
  );
  const childCount = new Map<string, number>();
  for (const [index, community] of value.communities.entries()) {
    if (!isPlainObject(community)) continue;
    const at = `communities[${index}]`;
    const id = typeof community.id === 'string' ? community.id : null;
    const parent = community.parentCommunity == null ? null : String(community.parentCommunity);
    if (!parent) continue;
    if (!ids.has(parent)) {
      issues.push({ path: `${at}.parentCommunity`, reason: `unknown parent domain: ${parent}` });
      continue;
    }
    if (parent === id) {
      issues.push({ path: `${at}.parentCommunity`, reason: 'a community cannot be its own parent' });
      continue;
    }
    /*
     An active community does not hang from a dead parent.

     The parent did exist in the registry — the rule above was therefore
     satisfied — but it could be deprecated. Yet `communityHierarchy` only
     builds the tree from ACTIVE communities: the child would then fall
     out of the hierarchy and come back as a root bubble on the map,
     contradicting what the registry declared. A valid registry must not
     be able to describe two different trees depending on who reads it.
    */
    if (community.deprecated !== true && deprecatedIds.has(parent)) {
      issues.push({ path: `${at}.parentCommunity`, reason: `deprecated parent domain: ${parent}` });
      continue;
    }
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);

    // Bounded walk-up: a cycle would make the depth infinite and would
    // loop every consumer that walks up the tree — map included.
    let depth = 1;
    let cursor = parent;
    const seenAncestors = new Set<string>([id ?? at]);
    while (cursor) {
      if (seenAncestors.has(cursor)) {
        issues.push({ path: `${at}.parentCommunity`, reason: `parent cycle via ${cursor}` });
        depth = Number.POSITIVE_INFINITY;
        break;
      }
      seenAncestors.add(cursor);
      const next = parentOf.get(cursor) ?? null;
      if (!next) break;
      cursor = next;
      depth += 1;
    }
    if (depth > MAX_COMMUNITY_DEPTH - 1) {
      issues.push({
        path: `${at}.parentCommunity`,
        reason: `depth ${depth + 1} beyond the maximum ${MAX_COMMUNITY_DEPTH}`,
      });
    }
  }

  for (const [index, community] of value.communities.entries()) {
    if (!isPlainObject(community)) continue;
    const at = `communities[${index}]`;
    const replacedBy = community.replacedBy;
    if (replacedBy != null && !ids.has(String(replacedBy))) {
      issues.push({ path: `${at}.replacedBy`, reason: `unknown target: ${String(replacedBy)}` });
    }
    if (community.replaces !== undefined) {
      if (!Array.isArray(community.replaces)) {
        issues.push({ path: `${at}.replaces`, reason: 'list expected' });
      } else {
        for (const target of community.replaces) {
          if (!ids.has(String(target))) {
            issues.push({ path: `${at}.replaces`, reason: `unknown absorbed concept: ${String(target)}` });
          }
        }
      }
    }
  }

  if (!isPlainObject(value.assignments)) {
    issues.push({ path: 'assignments', reason: 'object expected' });
  } else {
    const active = new Set(
      value.communities
        .filter((community) => isPlainObject(community) && community.deprecated !== true)
        .map((community) => String((community as Record<string, unknown>).id)),
    );
    const declaredCorpus = Array.isArray(value.corpusPageIds)
      ? new Set(value.corpusPageIds.map(String))
      : null;
    for (const [page, assignment] of Object.entries(value.assignments)) {
      /*
       An assigned page belongs to the declared corpus.

       Without this rule, `classified + pending + outside-sample + unclassified`
       would not add back up to the corpus, and the counters shown on the map
       would stop being verifiable.
      */
      if (declaredCorpus && !declaredCorpus.has(page)) {
        issues.push({
          path: `assignments["${page}"]`,
          reason: 'assigned page absent from corpusPageIds',
        });
      }
      /*
       A page attaches to a LEAF, never to a domain.

       That is the invariant that prevents the catch-all: a domain aggregates its
       communities, it does not replace them. Allowing direct attachment
       would reopen exactly the door through which 142 pages ended
       up in a single bubble, and a click on the domain would display
       again a list that nobody can read.
      */
      if (isPlainObject(assignment)
        && typeof assignment.primaryCommunity === 'string'
        && (childCount.get(assignment.primaryCommunity) ?? 0) > 0) {
        issues.push({
          path: `assignments["${page}"].primaryCommunity`,
          reason: `attachment to a parent domain: ${assignment.primaryCommunity} carries child communities`,
        });
      }
      if (isPlainObject(assignment) && assignment.relatedCommunities !== undefined) {
        const related = assignment.relatedCommunities;
        if (!Array.isArray(related)) {
          issues.push({ path: `assignments["${page}"].relatedCommunities`, reason: 'list expected' });
        } else {
          for (const target of related) {
            if (!active.has(String(target))) {
              issues.push({
                path: `assignments["${page}"].relatedCommunities`,
                reason: `unknown or deprecated community: ${String(target)}`,
              });
            } else if (String(target) === assignment.primaryCommunity) {
              // A facet that repeats the main membership adds nothing
              // and would falsify any count that adds the two together.
              issues.push({
                path: `assignments["${page}"].relatedCommunities`,
                reason: `facet redundant with primaryCommunity: ${String(target)}`,
              });
            }
          }
        }
      }
      if (!isPlainObject(assignment) || typeof assignment.primaryCommunity !== 'string') {
        issues.push({ path: `assignments["${page}"]`, reason: 'missing primaryCommunity' });
        continue;
      }
      if (!active.has(assignment.primaryCommunity)) {
        // Assigning a page to an absorbed concept would make it disappear from the
        // map without anything signalling it.
        issues.push({
          path: `assignments["${page}"].primaryCommunity`,
          reason: `unknown or deprecated community: ${assignment.primaryCommunity}`,
        });
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, registry: value as unknown as TaxonomyRegistry };
}

/**
 * Label to display for a community, in the wanted language.
 *
 * This is the only point where the registry vocabulary becomes the string that the
 * snapshot exposes. The configured language first, then a fallback, then
 * the identifier — never anything empty.
 */
export function communityLabel(
  community: RegistryCommunity,
  language: string,
  fallbackLanguage = 'en',
): string {
  return (
    community.prefLabel[language]
    ?? community.prefLabel[fallbackLanguage]
    ?? Object.values(community.prefLabel)[0]
    ?? community.id
  );
}

/** Follows absorptions up to the active concept, bounding cycles. */
export function resolveCommunity(
  registry: TaxonomyRegistry,
  id: string,
): RegistryCommunity | null {
  const byId = new Map(registry.communities.map((community) => [community.id, community]));
  let current = byId.get(id) ?? null;
  for (let hops = 0; current?.deprecated && current.replacedBy && hops < 16; hops += 1) {
    current = byId.get(current.replacedBy) ?? null;
  }
  return current ?? null;
}
