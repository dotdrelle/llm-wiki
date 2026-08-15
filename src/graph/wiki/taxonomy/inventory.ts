import type { WikiGraphSnapshot } from '../snapshot.ts';
import { orderPagesForSampling } from './coverage.ts';
import { KNOWLEDGE_NODE_TYPES } from './knowledge.ts';
import type { TaxonomyRegistry } from './schema.ts';
import { communityLabel } from './schema.ts';
import { normalizeProvenanceValue } from '../../../ingest/provenance.ts';

/*
 Inventory submitted to synthesis.

 It is for DECIDING, not for rendering the pages. That is the same discipline as
 `summarizeWikiGraph`: injecting content would blow up the turn window
 meant to plan cheaply, and the model does not need to read in order to
 recognize a domain — it needs to see titles, neighbourhoods and
 tags.
*/

/** Beyond this, a title brings no more information, it consumes budget. */
const MAX_TITLE = 90;
/** An excerpt serves to lift a title ambiguity, not to summarize the page. */
const MAX_EXCERPT = 160;
/** Neighbours cited per page: beyond this, the signal drowns in noise. */
const MAX_NEIGHBOURS = 6;

export type InventoryPage = {
  id: string;
  title: string;
  /** Ingestion index, never a decision. */
  group?: string;
  /** Concept folder, when there is one. */
  folder?: string;
  excerpt?: string;
  neighbours: string[];
};

export type InventoryCommunity = {
  id: string;
  label: string;
  size: number;
  /** Most connected pages: enough to recognize the domain without reading it. */
  topPages: string[];
};

export type InventoryFamily = {
  /** Short, deterministic identifier used in the model's answer. */
  id: string;
  /** Pages developed locally after the decision; never repeated by the LLM. */
  members: string[];
  titles: string[];
  signals: string[];
  /** Shared comparative collections: relation, never merge. */
  collections: string[];
  /**
   * What distinguishes this study from its sisters in the same collection.
   *
   * Derived by vocabulary difference, never from a product list. When
   * it exists, the leaf label must preserve it: it is the identity of the
   * compared subject, and losing it means no longer being able to navigate to it.
   */
  distinctiveTerms: string[];
  neighbours: string[];
};

export type TaxonomyInventory = {
  language: string;
  corpus: string;
  pageCount: number;
  pages: InventoryPage[];
  /**
   * All knowledge pages of the corpus, sample included.
   *
   * `pages` is the sample submitted to the model; this field is the real corpus.
   * Confusing the two made every non-sampled page disappear from the published
   * registry: the caller needs to know what the decision must apply to, not only
   * what it was made on.
   */
  corpusPageIds: string[];
  /**
   * Pages actually submitted to the model in this pass.
   *
   * Mirror of `pages`, in the shape the registry publishes. A corpus page
   * that is not in it was judged by nobody: that is what distinguishes
   * `outside-sample` from a classification failure.
   */
  sampledPageIds: string[];
  families: InventoryFamily[];
  communities: InventoryCommunity[];
  /** True when the corpus had to be truncated to fit the budget. */
  truncated: boolean;
};

const KNOWLEDGE_TYPES = KNOWLEDGE_NODE_TYPES;

function shorten(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function conceptFolder(id: string): string | undefined {
  const parts = id.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4 ? parts[2] : undefined;
}

function parentPath(id: string): string {
  const at = id.lastIndexOf('/');
  return at < 0 ? '' : id.slice(0, at);
}

function familyKey(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Builds the inventory from the snapshot and the current registry.
 *
 * The public snapshot already carries no `raw`, no `html`, no `preview`:
 * the inventory therefore has no way to take content from it, which is the
 * guarantee we want. Any excerpts are provided by the caller,
 * who alone knows how to read them at an acceptable cost.
 *
 * `maxPages` bounds the submitted corpus. Beyond it, we keep the most
 * connected pages: they are the ones that carry the structure, and a domain is
 * recognized by its central pages long before its leaves.
 */
export function buildTaxonomyInventory(
  snapshot: WikiGraphSnapshot,
  options: {
    language: string;
    registry?: TaxonomyRegistry | null;
    excerpts?: Map<string, string>;
    maxPages?: number;
    /**
     * Knowledge corpus fingerprint.
     *
     * The snapshot's `structureEtag` describes the complete graph — templates and
     * deliverables included — and serves as a fallback as long as a caller provides
     * nothing. Synthesis, on the other hand, always publishes the knowledge fingerprint:
     * it is what decides staleness.
     */
    corpus?: string;
    /** Pages already assigned by the fresh registry. */
    covered?: Set<string>;
    /** Pages left outside the sample in previous passes. */
    previouslyOutsideSample?: Set<string>;
  },
): TaxonomyInventory {
  const maxPages = options.maxPages ?? 400;
  const excerpts = options.excerpts ?? new Map<string, string>();

  const knowledge = snapshot.nodes.filter((node) => KNOWLEDGE_TYPES.has(node.type));
  const degree = new Map<string, number>();
  const neighbours = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    if (!neighbours.has(edge.from)) neighbours.set(edge.from, []);
    if (!neighbours.has(edge.to)) neighbours.set(edge.to, []);
    neighbours.get(edge.from)!.push(edge.to);
    neighbours.get(edge.to)!.push(edge.from);
  }

  /*
   Submission order: what has never been judged goes first.

   Sorting by degree alone kept excluding the same pages — the most recent
   are the least connected — and left them indefinitely outside the sample.
   `orderPagesForSampling` carries the rule; degree now only serves to break
   ties at equal priority.
  */
  const nodeIndex = new Map(knowledge.map((node) => [node.id, node]));
  const ranked = orderPagesForSampling(knowledge.map((node) => node.id), {
    covered: options.covered ?? new Set<string>(),
    previouslyOutsideSample: options.previouslyOutsideSample,
    degree,
  }).map((id) => nodeIndex.get(id)!);
  const kept = ranked.slice(0, maxPages);
  const keptIds = new Set(kept.map((node) => node.id));

  const pages: InventoryPage[] = kept.map((node) => {
    const excerpt = excerpts.get(node.id);
    const folder = conceptFolder(node.id);
    return {
      id: node.id,
      title: shorten(node.title, MAX_TITLE),
      ...(node.group ? { group: shorten(node.group, MAX_TITLE) } : {}),
      ...(folder ? { folder } : {}),
      ...(excerpt ? { excerpt: shorten(excerpt, MAX_EXCERPT) } : {}),
      // The neighbourhood is what distinguishes a domain from a tag: two
      // pages that cite each other probably belong to the same subject, whatever
      // their folder.
      neighbours: [...new Set(neighbours.get(node.id) ?? [])]
        .filter((id) => keptIds.has(id))
        .slice(0, MAX_NEIGHBOURS),
    };
  });

  /*
   Families are deterministic: Donna decides their DOMAIN, never their
   composition. That preserves the structures that flat classification
   destroyed on ACPI: sister documents of a single study, archived / source page
   mirror, and concepts explicitly sharing the same group or folder.
  */
  const parent = new Map(pages.map((page) => [page.id, page.id]));
  const find = (id: string): string => {
    const owner = parent.get(id) ?? id;
    if (owner === id) return id;
    const root = find(owner);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const a = find(left), b = find(right);
    if (a === b) return;
    parent.set(a.localeCompare(b) <= 0 ? b : a, a.localeCompare(b) <= 0 ? a : b);
  };
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const nodeById = new Map(kept.map((node) => [node.id, node]));

  // The common parent describes a COLLECTION, not an identity. Sister sources
  // must stay separate so they can become distinct communities under a single
  // domain.
  const rawByParent = new Map<string, string[]>();
  for (const node of kept) {
    if (node.type !== 'raw-source') continue;
    const key = parentPath(node.id);
    if (!rawByParent.has(key)) rawByParent.set(key, []);
    rawByParent.get(key)!.push(node.id);
  }
  const collectionByRaw = new Map<string, string>();
  // The collection id of a raw-source's parent folder, keyed by the normalized
  // folder name. Concept pages carry the same value in their `collection`
  // frontmatter (Lot 2), which is how they join their comparative collection.
  const collectionIdByFolder = new Map<string, string>();
  [...rawByParent.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([folder, ids], index) => {
      const collection = `c${String(index + 1).padStart(4, '0')}`;
      ids.forEach((id) => collectionByRaw.set(id, collection));
      const folderName = normalizeProvenanceValue(folder.split('/').pop() ?? '');
      if (folderName) collectionIdByFolder.set(folderName, collection);
    });

  // The wiki/sources mirror is not a second subject.
  for (const edge of snapshot.edges) {
    if (!pageById.has(edge.from) || !pageById.has(edge.to)) continue;
    const from = nodeById.get(edge.from)?.type;
    const to = nodeById.get(edge.to)?.type;
    if ((from === 'raw-source' && to === 'wiki-source')
      || (from === 'wiki-source' && to === 'raw-source')) unite(edge.from, edge.to);
  }

  /*
   `group:` no longer proves an identity — it only suggests one.

   The original comment already said that a group is a signal; the code, for its
   part, united all pages sharing exactly the same value. On ACPI this
   merged five different products under `security` or `integration`, while
   scattering the pages of a single product whose groups diverged. That is the
   provenance loss of § 0.4.

   Removing the global union without putting anything in its place would atomize the
   inventory until `subject`/`collection` arrive: a TRANSITORY union therefore
   remains, but it never crosses a provenance boundary.

   And it refuses ambiguity instead of arbitrating it. Union-find is transitive:
   a single page attached to two sources would suffice to re-chain their two
   collections, step by step, until reconstructing the massive merge we
   just removed. A page with multiple provenance — or none — therefore stays
   alone. There is no dominant provenance, nor first-link-wins.
  */
  const provenanceOf = new Map<string, string | null>();
  for (const page of pages) {
    const sources = [...new Set((neighbours.get(page.id) ?? []).filter((id) => {
      const type = nodeById.get(id)?.type;
      return type === 'wiki-source' || type === 'raw-source';
    }))];
    if (nodeById.get(page.id)?.type === 'raw-source'
      || nodeById.get(page.id)?.type === 'wiki-source') {
      provenanceOf.set(page.id, page.id);
      continue;
    }
    provenanceOf.set(page.id, sources.length === 1 ? sources[0]! : null);
  }
  const seeded = new Map<string, string[]>();
  for (const page of pages) {
    const signal = page.group;
    const provenance = provenanceOf.get(page.id);
    if (!signal || !provenance) continue;
    const key = `${provenance}${familyKey(signal)}`;
    if (!seeded.has(key)) seeded.set(key, []);
    seeded.get(key)!.push(page.id);
  }
  for (const ids of seeded.values()) ids.slice(1).forEach((id) => unite(ids[0]!, id));

  const buckets = new Map<string, InventoryPage[]>();
  for (const page of pages) {
    const key = find(page.id);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(page);
  }
  const ordered = [...buckets.values()].map((members) => members.sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => a[0]!.id.localeCompare(b[0]!.id));
  const familyByPage = new Map<string, string>();
  ordered.forEach((members, index) => members.forEach((page) => familyByPage.set(page.id, `f${String(index + 1).padStart(4, '0')}`)));
  const familyLinks = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    const from = familyByPage.get(edge.from), to = familyByPage.get(edge.to);
    if (!from || !to || from === to) continue;
    if (!familyLinks.has(from)) familyLinks.set(from, new Set());
    if (!familyLinks.has(to)) familyLinks.set(to, new Set());
    familyLinks.get(from)!.add(to);
    familyLinks.get(to)!.add(from);
  }
  const families: InventoryFamily[] = ordered.map((members, index) => {
    const id = `f${String(index + 1).padStart(4, '0')}`;
    return {
      id,
      members: members.map((page) => page.id),
      titles: [...new Set(members.map((page) => page.title))].slice(0, 8),
      signals: [...new Set(members.flatMap((page) => [page.group, page.folder].filter((value): value is string => Boolean(value))))].slice(0, 6),
      collections: [...new Set(members.flatMap((page) => {
        const fromRaw = collectionByRaw.get(page.id);
        const node = nodeById.get(page.id);
        const fromProvenance = node?.collection
          ? collectionIdByFolder.get(normalizeProvenanceValue(node.collection))
          : undefined;
        return [fromRaw, fromProvenance].filter((value): value is string => Boolean(value));
      }))].sort(),
      neighbours: [...(familyLinks.get(id) ?? [])].sort().slice(0, MAX_NEIGHBOURS),
      distinctiveTerms: [],
    };
  });

  /*
   Distinctive term of a study within its comparative collection.

   A collection compares N subjects; what identifies each one is precisely what
   its sisters do not have. The term is therefore derived from the corpus by
   difference, without the code knowing any product: it appears in the titles and
   paths of one family, and in no other family of the same collection.

   This is the guardrail that was missing. Without it, the model names each leaf
   after the FUNCTION of the subject — "planning", "visualization" — and the
   compared subjects disappear as navigable identities: the map becomes
   a list of functions from which one can no longer find out what they are about.
  */
  const familyById = new Map(families.map((family) => [family.id, family]));
  const termsOf = (family: InventoryFamily): Set<string> => new Set(
    [...family.titles, ...family.members.map((member) => member.replace(/\.md$/, '').split('/').pop() ?? '')]
      .flatMap((value) => familyKey(value).split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 3 && !/^\d+$/.test(token)),
  );
  /*
   Frequency of a term at the corpus scale.

   A token unique WITHIN its collection is not necessarily an identity: two
   documents filed in the same folder differ by a thousand naming
   accidents — "version", "source", "open", "study". These words come back
   everywhere else in the corpus, whereas a named subject appears only at
   home. It is this global rarity that separates an identity from an accident, and
   it is measured without knowing any product.
  */
  const familyFrequency = new Map<string, number>();
  const allTerms = new Map<string, Set<string>>();
  for (const family of families) {
    const terms = termsOf(family);
    allTerms.set(family.id, terms);
    for (const token of terms) familyFrequency.set(token, (familyFrequency.get(token) ?? 0) + 1);
  }

  const byCollection = new Map<string, InventoryFamily[]>();
  for (const family of families) {
    for (const collection of family.collections) {
      if (!byCollection.has(collection)) byCollection.set(collection, []);
      byCollection.get(collection)!.push(family);
    }
  }
  for (const siblings of byCollection.values()) {
    // A single-member collection compares nothing: there is no
    // difference to extract, and any term would look distinctive.
    if (siblings.length < 2) continue;
    for (const family of siblings) {
      const own = allTerms.get(family.id)!;
      const shared = new Set<string>();
      for (const sibling of siblings) {
        if (sibling.id === family.id) continue;
        for (const token of allTerms.get(sibling.id)!) if (own.has(token)) shared.add(token);
      }
      const derived = [...own]
        .filter((token) => !shared.has(token))
        // The term must exist ONLY at this family in the whole corpus.
        // Otherwise it describes a shared state, format or activity, and
        // imposing it as a community name would be worse than letting the choice open.
        .filter((token) => (familyFrequency.get(token) ?? 0) === 1)
        .sort();
      /*
       A `scope: product` page carries its canonical subject, injected by the
       engine (Lot 2). That subject IS the compared identity, even when the
       sibling source note's descriptive title also mentions it — the rarity
       filters above would otherwise erase `prophix` because both the source
       note and the concept carry it. The engine-declared subject wins.
       */
      const productSubjects = [...new Set(family.members.flatMap((member) => {
        const node = nodeById.get(member);
        return node?.scope === 'product' && node?.subject
          ? familyKey(node.subject).split(/[^a-z0-9]+/)
          : [];
      }).filter((token) => token.length >= 3 && !/^\d+$/.test(token)))];
      familyById.get(family.id)!.distinctiveTerms = [...new Set([...productSubjects, ...derived])].sort().slice(0, 4);
    }
  }

  const registry = options.registry ?? null;
  const communities: InventoryCommunity[] = registry
    ? registry.communities
        .filter((community) => !community.deprecated)
        .map((community) => {
          const members = Object.entries(registry.assignments)
            .filter(([, assignment]) => assignment.primaryCommunity === community.id)
            .map(([page]) => page);
          return {
            id: community.id,
            label: communityLabel(community, options.language),
            size: members.length,
            topPages: members
              .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
              .slice(0, 5),
          };
        })
    : snapshot.communities.map((community) => ({
        id: community.id,
        label: community.label,
        size: community.documentCount,
        topPages: community.nodeIds.filter((id) => keptIds.has(id)).slice(0, 5),
      }));

  return {
    language: options.language,
    corpus: options.corpus ?? snapshot.structureEtag,
    pageCount: knowledge.length,
    pages,
    corpusPageIds: knowledge.map((node) => node.id).sort(),
    sampledPageIds: pages.map((page) => page.id).sort(),
    families,
    communities,
    truncated: ranked.length > kept.length,
  };
}
