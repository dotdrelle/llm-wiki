import { consolidate, type LabelDecision } from './consolidation.ts';
import { computeCoverage, mergeSampledPages } from './coverage.ts';
import { checkDistribution } from './distribution.ts';
import { guardAgainstMassDisruption } from './filiation.ts';
import { KNOWLEDGE_ETAG_ALGORITHM, knowledgeEtag } from './knowledge.ts';
import {
  adoptByLabel,
  anchorCommunities,
  deprecateMissing,
  membersByCommunity,
  type AnchoredCommunity,
} from './identity.ts';
import { reattachOrphanedChildren } from './reanchor.ts';

// Re-exported for callers that already import it from the synthesis module.
export { reattachOrphanedChildren };
import { buildTaxonomyInventory, type TaxonomyInventory } from './inventory.ts';
import {
  clearDirtyFlag,
  publishGeneration,
  readActiveRegistry,
  readMarker,
  writeDirtyFlag,
  writeGeneration,
} from './store.ts';
import {
  communityLabel,
  REGISTRY_SCHEMA_VERSION,
  validateRegistry,
  type RegistryCommunity,
  type TaxonomyRegistry,
} from './schema.ts';
import {
  buildSynthesisPrompt,
  checkProposal,
  normalizeProposal,
  retryHint,
  semanticReviewPrompt,
  SYNTHESIS_SYSTEM,
  taxonomyProposalSchema,
  type TaxonomyProposal,
} from './synthesize.ts';
import { loadWikiGraphSnapshot } from '../overview.ts';

/** Re-synthesis attempts before giving up. D7 requires that the rejection be bounded. */
export const MAX_SYNTHESIS_ATTEMPTS = 3;

/**
 * Families submitted to the model in one pass.
 *
 * An explicit bound, because the two silent outcomes are worse: a
 * prompt that swells until it saturates the window, or a sampling of
 * families that nothing announces. Beyond it, the synthesis returns `deferred` with the
 * diagnostic `family-limit` and the previous registry stays active.
 *
 * The value exceeds the number of families measured on the reference corpus
 * after the transitory union, with a margin: a `deferred/family-limit` on this
 * corpus is a calibration failure to fix, not an acceptable result.
 */
export const MAX_SYNTHESIS_FAMILIES = 320;

export type SynthesizeDeps = {
  /** Structured completion of the configured LLM. Absent ⇒ nothing is attempted. */
  propose?: (request: { system: string; user: string }) => Promise<unknown>;
  excerpts?: Map<string, string>;
  maxPages?: number;
  maxFamilies?: number;
  now?: number;
  /**
   * Knowledge fingerprint frozen at the barrier, before the taxonomy task ran.
   *
   * The production capability freezes the corpus after the last `ingest_apply`
   * and the collection consolidation, then launches the single taxonomy task
   * with this value. If the corpus has moved since, the synthesis is stale and
   * must not pay for a proposal the compare-and-swap would reject anyway.
   */
  expectedCorpus?: string;
};

export type SynthesizeOutcome =
  | {
      status: 'published';
      revision: number;
      /** Root domains: what the map shows. */
      communities: number;
      /** Leaf communities: what a domain opens. */
      leaves: number;
      /** Quality reserves: published, never blocking. */
      warnings: string[];
      /**
       * Corpus pages still never submitted after this pass.
       *
       * Non-zero ⇒ an additional pass on the SAME corpus fingerprint has
       * something to classify. That is the drain driver, which the production
       * capability consumes; the engine, for its part, never loops alone.
       */
      outsideSample: number;
      /** Hysteresis verdicts (see `consolidation.ts`), flattened domains excluded. */
      labelDecisions: LabelDecision[];
      inventory: TaxonomyInventory;
    }
  | { status: 'unchanged'; revision: number }
  | { status: 'skipped'; reason: 'no_llm' | 'empty_corpus' }
  | { status: 'rejected'; issues: string[] }
  | { status: 'stale' }
  /**
   * `reason` is only filled for an unexpected failure, never for a lock.
   * `code` names the planned deferrals — `family-limit` today.
   *
   * `deferred` is a SYNTHESIS result; `pending-classification` is a
   * PAGE state. The two vocabularies are never used for one
   * another: confusing a deferral with a coverage is precisely what made
   * § 0.3 unreadable.
   */
  | { status: 'deferred'; reason?: string; code?: 'family-limit' };

/**
 * Full synthesis: inventory → proposal → validation → published registry.
 *
 * The LLM call happens **outside the lock**, like the generation write: only
 * the marker compare-and-swap is serialized. A synthesis computed on a
 * fingerprint that became obsolete is abandoned at commit rather than published
 * over a more recent ingestion.
 *
 * Never throws. A failure leaves the previous registry active and sets
 * `pendingSynthesis`: Serve will publish the deterministic one, and the resumption goes back
 * to the next execution of the capability.
 */
export async function synthesizeTaxonomy(
  rootDir: string,
  options: { language: string; workspace?: string; force?: boolean },
  deps: SynthesizeDeps = {},
): Promise<SynthesizeOutcome> {
  /*
   The promise above was only held in the lower part of the function.

   Loading the snapshot, reading the active registry and building the
   inventory precede all the fallback mechanics and were covered by
   nothing: an unreadable file or a truncated registry therefore bubbled up to
   the caller. Yet these callers — the CLI command, the watcher, the production
   capability — were written believing the docstring, and none has a
   catch. A single failed read stopped what synthesis is supposed to
   degrade silently.

   The previous registry stays active in every case; the failure sets the flag
   and says so.
  */
  try {
    return await runSynthesis(rootDir, options, deps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The flag carries the corpus fingerprint: without a readable snapshot, we
    // do not have it, and there is nothing useful to write. The failure stays reported.
    await noteFailure(rootDir, '', [`synthesis: ${reason}`]).catch(() => {});
    return { status: 'deferred', reason };
  }
}

async function runSynthesis(
  rootDir: string,
  options: { language: string; workspace?: string; force?: boolean },
  deps: SynthesizeDeps,
): Promise<SynthesizeOutcome> {
  const snapshot = await loadWikiGraphSnapshot({
    rootDir,
    workspace: options.workspace,
    language: options.language,
  });
  if (!snapshot.nodes.length) return { status: 'skipped', reason: 'empty_corpus' };
  if (!deps.propose) {
    // Graceful degradation: without a configured LLM, the deterministic projection
    // stays in place and says so. Never an error, never an empty page.
    return { status: 'skipped', reason: 'no_llm' };
  }

  const active = await readActiveRegistry(rootDir);
  const validated = active?.registry ? validateRegistry(active.registry) : null;
  const previous: TaxonomyRegistry | null = validated?.ok ? validated.registry : null;

  /*
   The knowledge fingerprint, never the complete graph one.

   `snapshot.structureEtag` reacts to templates, contexts and deliverables: a
   synthesis computed on it would have declared itself stale at the first build, and the
   compare-and-swap would have rejected a perfectly valid proposal.
  */
  const corpus = await knowledgeEtag(rootDir);

  /*
   Barrier freeze, verified before any model call.

   The production capability freezes the fingerprint right after the last
   `ingest_apply` and the collection consolidation, then launches this single
   taxonomy task with it as `expectedCorpus`. If the corpus moved in between —
   a concurrent ingestion, a manual edit — the synthesis is stale before it
   starts: returning now is honest and spares the model the cost of a proposal
   the compare-and-swap would reject at publication anyway.
   */
  if (deps.expectedCorpus !== undefined && deps.expectedCorpus !== corpus) {
    return { status: 'stale' };
  }

  /*
   What the previous pass already judged guides this one.

   The already-covered pages go to the end of the sample — their assignment
   carries over without a new call — and those left outside the sample go
   first. That is what empties `outside-sample` instead of feeding it.

   But all of that only makes sense on the SAME corpus fingerprint. A stale
   registry proves no coverage: a page it declared classified may have
   been rewritten since, and relegating it to the end of the sample for that reason
   would mean pushing it out precisely because it changed. A
   new fingerprint therefore starts over without any page deemed covered.
  */
  const continues = previous?.corpus === corpus
    && previous?.corpusAlgorithm === KNOWLEDGE_ETAG_ALGORITHM;
  const covered = continues
    ? new Set(Object.keys(previous?.assignments ?? {}))
    : new Set<string>();
  const previouslyOutsideSample = continues
    ? new Set((previous?.corpusPageIds ?? []).filter(
        (page) => !(previous?.sampledPageIds ?? []).includes(page),
      ))
    : new Set<string>();

  const inventory = buildTaxonomyInventory(snapshot, {
    language: options.language,
    registry: previous,
    excerpts: deps.excerpts,
    maxPages: deps.maxPages,
    corpus,
    covered,
    previouslyOutsideSample,
  });

  /*
   Family bound: an explicit deferral rather than a prompt that overflows.

   As long as `subject`/`collection` do not exist, the inventory can
   fragment to the point of making the proposal unmanageable. Exceeding the bound
   is not a corpus error: it is an insufficient budget to decide
   honestly. We say so, we keep the previous registry, and nobody pays
   an oversized call.
  */
  const maxFamilies = deps.maxFamilies ?? MAX_SYNTHESIS_FAMILIES;
  if (inventory.families.length > maxFamilies) {
    await noteFailure(rootDir, corpus, [
      `family-limit: ${inventory.families.length} families for a bound of ${maxFamilies}`,
    ]);
    return {
      status: 'deferred',
      code: 'family-limit',
      reason: `${inventory.families.length} families beyond the bound ${maxFamilies}`,
    };
  }

  let proposal: TaxonomyProposal | null = null;
  let warnings: Array<{ path: string; reason: string }> = [];
  let reviewed = false;
  let lastIssues: string[] = [];
  let user = buildSynthesisPrompt(inventory);

  for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await deps.propose({ system: SYNTHESIS_SYSTEM, user });
    } catch (error) {
      lastIssues = [`llm: ${error instanceof Error ? error.message : String(error)}`];
      break;
    }
    const parsed = taxonomyProposalSchema.safeParse(raw);
    if (!parsed.success) {
      lastIssues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      user = `${buildSynthesisPrompt(inventory)}\n\n${retryHint(lastIssues.map((reason) => ({ path: '', reason })))}`;
      continue;
    }
    // The inconsequential typos are removed before being judged: an
    // empty community is not a meaning error, it is one line too many.
    const checked = checkProposal(normalizeProposal(parsed.data).proposal, inventory);
    if (checked.ok) {
      if (reviewed) {
        proposal = checked.proposal;
        // What falls under judgment does not block, but must be seen: that is the
        // only way for the user to know what the map lost.
        warnings = checked.warnings;
        break;
      }
      // A structurally valid answer can still name the editorial
      // work ("analysis", "study") instead of the subject. A second global
      // pass re-reads the whole proposal: two calls for the corpus,
      // never one call per page or per family.
      reviewed = true;
      user = semanticReviewPrompt(inventory, checked.proposal);
      continue;
    }
    lastIssues = checked.issues.map((issue) => `${issue.path}: ${issue.reason}`);
    user = `${buildSynthesisPrompt(inventory)}\n\n${retryHint(checked.issues)}`;
  }

  if (!proposal) {
    await noteFailure(rootDir, inventory.corpus, lastIssues);
    return { status: 'rejected', issues: lastIssues };
  }

  /*
   Real members of each level.

   A leaf carries the pages of its families; a domain carries the union of
   its leaves. The domain receives NO page in the registry — that is
   the invariant that forbids the catch-all — but it needs these members to
   be re-anchored: a bubble is recognized by its content, not by its name.
  */
  // Non-null only when the corpus was truncated: without truncation, the
  // comparison already covers the whole corpus on both sides.
  const sampledPages = inventory.truncated
    ? new Set(inventory.pages.map((page) => page.id))
    : null;
  const familyById = new Map(inventory.families.map((family) => [family.id, family]));
  const membersByLeaf = new Map<string, string[]>();
  for (const [familyId, leafId] of Object.entries(proposal.assignments)) {
    const members = familyById.get(familyId)?.members ?? [];
    if (!membersByLeaf.has(leafId)) membersByLeaf.set(leafId, []);
    membersByLeaf.get(leafId)!.push(...members);
  }
  const leafDomain = new Map(proposal.communities.map((community) => [community.id, community.domain]));
  const membersByDomain = new Map<string, string[]>();
  for (const [leafId, members] of membersByLeaf) {
    const domainId = leafDomain.get(leafId);
    if (!domainId) continue;
    if (!membersByDomain.has(domainId)) membersByDomain.set(domainId, []);
    membersByDomain.get(domainId)!.push(...members);
  }

  const marker = await readMarker(rootDir);
  const revision = (marker?.revision ?? 0) + 1;

  /*
   Preserved communities: live, but never submitted to this turn.

   Computed BEFORE anchoring, because anchoring needs them. A drain
   pass submits a sample disjoint from the previous one: the model does not see
   these communities and can propose their homonym. Without knowing them here, we
   published two same-named sisters — invalid registry, rejected synthesis, drain
   impossible to finish.
  */
  const corpusPages = new Set(inventory.corpusPageIds);
  const untouched: RegistryCommunity[] = [];
  if (sampledPages && previous) {
    const previousMembers = membersByCommunity(previous);
    for (const community of previous.communities) {
      if (community.deprecated) continue;
      const members = previousMembers.get(community.id) ?? [];
      const stillLive = members.filter((page) => corpusPages.has(page));
      if (!stillLive.length) continue;
      if (stillLive.some((page) => sampledPages.has(page))) continue;
      untouched.push(community);
    }
  }
  const preservedAt = (parentId: string | null) => untouched
    .filter((community) => (community.parentCommunity ?? null) === parentId)
    .map((community) => ({ id: community.id, label: communityLabel(community, options.language) }));
  const adoptedIds = new Set<string>();

  /*
   Anchoring and consolidation PER LEVEL.

   Both functions assume a flat list of peers. Calling them on
   the whole tree would let a domain seize the identifier of a
   leaf — their members overlap by construction, a domain containing
   exactly the union of its leaves — and a renamed domain would then carry
   its children away. We therefore isolate each level, and for the leaves each
   sibling group, which gives along the way the right uniqueness scope.
  */
  const domainAdoption = adoptByLabel(
    anchorCommunities(
      proposal.domains.map((domain) => ({ members: membersByDomain.get(domain.id) ?? [], label: domain.label })),
      registryAtLevel(previous, 'root', undefined, sampledPages),
      { now: deps.now },
    ),
    preservedAt(null),
  );
  const anchoredDomains = domainAdoption.communities;
  for (const id of domainAdoption.adopted) adoptedIds.add(id);
  const domainIdByProposal = new Map(
    proposal.domains.map((domain, index) => [domain.id, anchoredDomains[index]!.id]),
  );

  const consolidatedDomains = consolidate(anchoredDomains, registryAtLevel(previous, 'root', undefined, sampledPages), {
    language: options.language,
    revision,
    force: options.force,
  });
  if (!consolidatedDomains.ok) {
    return rejectConflicts(rootDir, inventory.corpus, consolidatedDomains.conflicts);
  }

  // Domains first, then each sibling group of leaves: the order the map reads.
  const labelDecisions: LabelDecision[] = [...consolidatedDomains.decisions];

  const leafCommunities: RegistryCommunity[] = [];
  const anchoredLeaves: AnchoredCommunity[] = [];
  /** Identifier proposed by the model → stable registry identifier. */
  const leafById = new Map<string, string>();
  /** Flattened domains: their single child became a root. */
  const collapsedDomains = new Set<string>();
  for (const domain of proposal.domains) {
    const siblings = proposal.communities.filter((community) => community.domain === domain.id);
    const parentId = domainIdByProposal.get(domain.id)!;
    const scope = registryAtLevel(previous, 'leaf', parentId, sampledPages);
    const leafAdoption = adoptByLabel(
      anchorCommunities(
        siblings.map((community) => ({ members: membersByLeaf.get(community.id) ?? [], label: community.label })),
        scope,
        { now: deps.now },
      ),
      preservedAt(parentId),
    );
    const anchored = leafAdoption.communities;
    for (const id of leafAdoption.adopted) adoptedIds.add(id);
    const consolidated = consolidate(anchored, scope, {
      language: options.language,
      revision,
      force: options.force,
    });
    if (!consolidated.ok) return rejectConflicts(rootDir, inventory.corpus, consolidated.conflicts);
    labelDecisions.push(...consolidated.decisions);

    /*
     A domain that separates nothing is flattened, not rejected.

     With a single daughter community, the domain imposes two clicks where
     one suffices: we therefore promote the child to root. The schema accepts it — a
     childless root is a leaf — and the map displays it as an ordinary
     bubble. No page changes community.
    */
    const collapse = siblings.length === 1;
    siblings.forEach((community, index) => {
      const id = anchored[index]!.id;
      leafById.set(community.id, id);
      leafCommunities.push({
        ...consolidated.communities[index]!,
        id,
        parentCommunity: collapse ? null : parentId,
      });
    });
    if (collapse) collapsedDomains.add(parentId);
    anchoredLeaves.push(...anchored);
  }

  const collectionLeaves = new Map<string, Set<string>>();
  for (const family of inventory.families) {
    const proposedLeaf = proposal.assignments[family.id];
    const stableLeaf = proposedLeaf ? leafById.get(proposedLeaf) : undefined;
    if (!stableLeaf) continue;
    for (const collection of family.collections) {
      const leaves = collectionLeaves.get(collection) ?? new Set<string>();
      leaves.add(stableLeaf);
      collectionLeaves.set(collection, leaves);
    }
  }

  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const family of inventory.families) {
    const proposedLeaf = proposal.assignments[family.id];
    const primaryCommunity = proposedLeaf ? leafById.get(proposedLeaf) : undefined;
    if (!primaryCommunity) continue;
    const relatedCommunities = [...new Set(family.collections.flatMap((collection) =>
      [...(collectionLeaves.get(collection) ?? [])]))]
      .filter((id) => id !== primaryCommunity)
      .sort();
    // The pages are only attached to leaves: the collection adds
    // relations towards its other subjects, without changing their placement.
    for (const page of family.members) {
      assignments[page] = {
        primaryCommunity,
        ...(relatedCommunities.length ? { relatedCommunities } : {}),
      };
    }
  }

  /*
   A community the model never saw was not deleted by it.

   On a truncated corpus, the proposal only speaks of the sample. The
   communities of which no page appeared there therefore appeared in no
   draft, were treated as gone, and got deprecated — with
   their pages, which had no target left to be carried over to. Inferring a
   deletion from an absence of information is precisely inventing a
   decision nobody made.

   They therefore cross the revision intact. Those of which part of the pages
   was visible, on the other hand, were indeed judged: if the model
   set them aside, that is a decision, and the ordinary deprecation applies.
  */
  /*
   A community adopted by its label is no longer "preserved": it has
   become the current draft again, with its members and its label of the turn.
   Leaving it also in the preserved list would make it appear twice in
   the published registry, under the same identifier.
  */
  const preserved = untouched.filter((community) => !adoptedIds.has(community.id));
  const untouchedSurvivors: AnchoredCommunity[] = preserved.map((community) => ({
    id: community.id,
    members: [],
    label: '',
    reanchored: true,
  }));

  // The gone ones are never deleted: they keep their identifier
  // and point at their replacement, otherwise a merge would be indistinguishable
  // from a destruction for a client that comes back.
  const communities: RegistryCommunity[] = [
    ...preserved,
      // A flattened domain disappears: its single child replaces it at the root.
      ...consolidatedDomains.communities
        .filter((community) => !collapsedDomains.has(community.id))
        .map((community) => ({ ...community, parentCommunity: null })),
      ...leafCommunities,
      /*
       A flattened domain is not a survivor.

       It was removed from `communities` by the filter above while remaining
       in the list passed here: `deprecateMissing` therefore saw it as "alive" and
       wrote no stub for it. Its identifier simply disappeared
       from the registry — the only case where a community vanishes without
       leaving a trace, which the rest of the model precisely forbids
       so that an old selection stays resolvable.

       Excluded from here, it becomes an ordinary disappearance again, and the
       member overlap makes it point at its single promoted child — which carries
       exactly the same pages, hence an overlap of 1.
      */
      ...deprecateMissing(
        previous,
        [
          ...anchoredDomains.filter((domain) => !collapsedDomains.has(domain.id)),
          ...anchoredLeaves,
          // Untouched for lack of being submitted: alive, hence never
          // deprecated.
          ...untouchedSurvivors,
        ],
        revision,
      ),
  ];

  reattachOrphanedChildren(communities);

  /*
   The sample decides; the whole corpus receives the decision.

   `maxPages` bounds what we SUBMIT to the model — beyond it, we keep the most
   connected pages, which carry the structure. But the assignments were
   then rebuilt from that sample alone: beyond 400 pages,
   or under `--max-pages`, all the others disappeared from the published registry.
   They then fell back on the deterministic projection while the
   snapshot announced a synthesized taxonomy — and the next synthesis
   erased their previous assignment along the way.

   A non-sampled page is not a page without a decision: the previous
   revision's is still the best available information, and nothing in
   this run contradicts it. We therefore carry it over, following it through the
   merges, exactly as we would resolve an old selection.
  */
  const liveCommunities = new Map(communities.map((community) => [community.id, community]));
  const survivingTarget = (id: string): string | null => {
    let current = liveCommunities.get(id) ?? null;
    for (let hops = 0; current?.deprecated && current.replacedBy && hops < 16; hops += 1) {
      current = liveCommunities.get(current.replacedBy) ?? null;
    }
    // A deprecated target without a replacement is a truly vanished concept:
    // carrying it over would make the page invisible on the map.
    return current && !current.deprecated ? current.id : null;
  };
  let carriedOver = 0;
  for (const [page, assignment] of Object.entries(previous?.assignments ?? {})) {
    // A page that left the corpus is not carried over: it no longer exists.
    if (assignments[page] || !corpusPages.has(page)) continue;
    const primaryCommunity = survivingTarget(assignment.primaryCommunity);
    if (!primaryCommunity) continue;
    const relatedCommunities = [...new Set(
      (assignment.relatedCommunities ?? [])
        .map((id) => survivingTarget(id))
        .filter((id): id is string => Boolean(id) && id !== primaryCommunity),
    )].sort();
    assignments[page] = {
      primaryCommunity,
      ...(relatedCommunities.length ? { relatedCommunities } : {}),
    };
    carriedOver += 1;
  }

  /*
   What remains without assignment must be said.

   A page neither sampled nor already classified has no decision concerning it.
   Publishing without signalling it would make one believe the map covers the whole
   corpus. This is a reserve, not an error: the map stays right on what
   it shows, and refusing to publish would deprive it of everything.
  */
  const submitted = new Set(inventory.sampledPageIds);
  const unassigned = inventory.corpusPageIds.filter((page) => !assignments[page]);
  const neverSubmitted = unassigned.filter((page) => !submitted.has(page)).length;
  const judged = unassigned.length - neverSubmitted;
  if (unassigned.length > 0) {
    // Two causes, two sentences: "never submitted" is a sampling
    // budget, "submitted and not kept" is a model decision.
    // Adding them up under a single number would make the diagnosis unexploitable.
    warnings = [...warnings, {
      path: 'assignments',
      reason: `${unassigned.length} page(s) without assignment out of ${inventory.pageCount}`
        + ` : ${neverSubmitted} outside the sample, ${judged} submitted and not kept`
        + `${carriedOver ? `, ${carriedOver} assignment(s) carried over from the previous revision` : ''}`,
    }];
  }

  /*
   CUMULATIVE sample over a single corpus fingerprint.

   Without this accumulation, pass 2 would classify what pass 1 left while
   making pass 1's sample fall back into `outside-sample`: the
   drain would oscillate without ever converging. A new fingerprint, for its part,
   starts over from the corpus it describes.
  */
  const sampledPageIds = mergeSampledPages({
    previous,
    corpus: inventory.corpus,
    current: inventory.sampledPageIds,
    corpusPageIds: inventory.corpusPageIds,
  });

  const registry: TaxonomyRegistry = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision,
    corpus: inventory.corpus,
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    languages: [...new Set([...(previous?.languages ?? []), options.language])],
    communities,
    assignments,
    corpusPageIds: inventory.corpusPageIds,
    sampledPageIds,
  };

  // Guardrail (Lot 3, 6.3): too large a share of active communities
  // vanished without a successor is a hole; force does not lift this promise.
  const filiationGuard = guardAgainstMassDisruption(previous, communities);
  if (!filiationGuard.ok) {
    await noteFailure(rootDir, inventory.corpus, filiationGuard.issues);
    return { status: 'rejected', issues: filiationGuard.issues };
  }

  /*
   Distribution check before publication.

   The revision that merged 142 pages into a bubble was structurally
   valid: consistent identifiers, conforming labels, complete coverage.
   Validation answers "is this registry coherent?"; this check answers
   "is this map navigable?". Both must pass.
  */
  const distribution = checkDistribution(registry);
  if (!distribution.ok) {
    const issues = distribution.issues.map((issue) => `${issue.code}: ${issue.reason}`);
    await noteFailure(rootDir, inventory.corpus, issues);
    return { status: 'rejected', issues };
  }

  const guard = validateRegistry(registry);
  if (!guard.ok) {
    // Safety net: a registry built by us must pass the
    // same check as the one we re-read from disk, otherwise the validation is
    // worthless.
    const issues = guard.issues.map((issue) => `${issue.path}: ${issue.reason}`);
    await noteFailure(rootDir, inventory.corpus, issues);
    return { status: 'rejected', issues };
  }

  const generation = await writeGeneration(rootDir, registry);
  const outcome = await publishGeneration(rootDir, {
    corpus: inventory.corpus,
    corpusAlgorithm: KNOWLEDGE_ETAG_ALGORITHM,
    registryRef: generation.ref,
    registryHash: generation.hash,
    expectedCorpus: inventory.corpus,
  });

  if (outcome.status === 'stale') return { status: 'stale' };
  if (outcome.status !== 'published') {
    await noteFailure(rootDir, inventory.corpus, ['publication unavailable']);
    return { status: 'deferred' };
  }
  // A valid publication satisfies equally well a deterministic fallback and a
  // synthesis resumption. Leaving the flag would make the next restart
  // believe work remains pending while the commit is active.
  await clearDirtyFlag(rootDir).catch(() => {});
  return {
    status: 'published',
    revision: outcome.marker.revision,
    // What the user sees on the map are the domains; the leaf
    // count says nothing about the first screen's readability.
    //
    // We count AFTER the flattening: a single-child domain disappeared from the
    // registry, and announcing it anyway would make one look on the map for a bubble
    // that does not exist — the same defect as "33 communities" on a map
    // that folded 3 of them away.
    communities: consolidatedDomains.communities.filter(
      (community) => !collapsedDomains.has(community.id),
    ).length,
    leaves: leafCommunities.length,
    warnings: warnings.map((issue) => `${issue.path}: ${issue.reason}`),
    labelDecisions: labelDecisions.filter((decision) => !collapsedDomains.has(decision.id)),
    // What remains to submit on this same fingerprint: the drain
    // driver, never a non-classification accusation.
    outsideSample: computeCoverage({
      corpus: inventory.corpus,
      corpusPageIds: inventory.corpusPageIds,
      marker: outcome.marker,
      registry,
    }).counts['outside-sample'],
    inventory,
  };
}

/**
 * View of the previous registry restricted to a level, for re-anchoring.
 *
 * A domain and its leaves share their members by construction: without
 * this restriction, the overlap pairing would let a domain
 * claim the identifier of one of its leaves, or the reverse. We therefore
 * compare peers to peers — and for the leaves, a sibling group to its sibling group.
 */
function registryAtLevel(
  previous: TaxonomyRegistry | null,
  level: 'root' | 'leaf',
  parentId?: string,
  /*
   Pages actually submitted to the model, when the corpus was truncated.

   Re-anchoring recognizes a community by the overlap of its members. On a
   truncated corpus, the proposal only speaks of the sample: compared to the
   COMPLETE members of the previous revision, an intact community fell
   below the threshold and lost its identity — then got deprecated, and the
   outside-sample pages no longer even had a target to be carried over to.

   It is not the community that changed, it is what we show of it. We therefore
   compare both sides on the same sample: comparing what is comparable
   is the condition for the overlap to mean anything.
  */
  sampled?: Set<string> | null,
): TaxonomyRegistry | null {
  if (!previous) return null;
  const children = new Set(
    previous.communities.filter((item) => item.parentCommunity).map((item) => item.parentCommunity as string),
  );
  const kept = previous.communities.filter((community) => {
    if (community.deprecated) return false;
    if (level === 'root') return !community.parentCommunity;
    return parentId ? community.parentCommunity === parentId : Boolean(community.parentCommunity);
  });
  const keptIds = new Set(kept.map((community) => community.id));

  const assignments: TaxonomyRegistry['assignments'] = {};
  for (const [page, assignment] of Object.entries(previous.assignments)) {
    if (sampled && !sampled.has(page)) continue;
    if (level === 'leaf') {
      if (keptIds.has(assignment.primaryCommunity)) assignments[page] = assignment;
      continue;
    }
    // At root level, a domain's members are those of its leaves:
    // that is what lets it be recognized after a rename.
    const leaf = previous.communities.find((item) => item.id === assignment.primaryCommunity);
    const root = leaf?.parentCommunity ?? (children.has(assignment.primaryCommunity) ? null : assignment.primaryCommunity);
    if (root && keptIds.has(root)) assignments[page] = { primaryCommunity: root };
  }
  return { ...previous, communities: kept, assignments };
}

async function rejectConflicts(
  rootDir: string,
  corpus: string,
  conflicts: Array<{ label: string; ids: string[] }>,
): Promise<SynthesizeOutcome> {
  const issues = conflicts.map((conflict) => `label: "${conflict.label}" shared by ${conflict.ids.join(', ')}`);
  await noteFailure(rootDir, corpus, issues);
  return { status: 'rejected', issues };
}

async function noteFailure(rootDir: string, corpus: string, issues: string[]): Promise<void> {
  const marker = await readMarker(rootDir);
  await writeDirtyFlag(rootDir, {
    kind: 'pendingSynthesis',
    corpus,
    baseRevision: marker?.revision ?? 0,
    at: Date.now(),
  }).catch(() => {});
  void issues;
}
