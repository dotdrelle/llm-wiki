import { createHash } from 'node:crypto';
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeType,
  WikiGraphRelationType,
} from './projection.ts';

export type CommunityAssignment = {
  communityId: string;
  communityLabel: string;
  assignment: 'explicit' | 'inherited' | 'fallback';
};

export type WikiGraphCommunity = {
  id: string;
  label: string;
  nodeIds: string[];
  documentCount: number;
  conceptCount: number;
  sourceCount: number;
  internalRelations: number;
  externalRelations: number;
};

export type WikiGraphCommunityEdge = {
  from: string;
  to: string;
  count: number;
  relations: Partial<Record<WikiGraphRelationType, number>>;
};

export type CommunityProjection = {
  communities: WikiGraphCommunity[];
  communityEdges: WikiGraphCommunityEdge[];
  topologyEtag: string;
};

type ExplicitCommunity = { label: string } | undefined;

export function communityId(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'ungrouped';
}

function title(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function conceptFolder(nodeId: string): string | undefined {
  const parts = nodeId.split('/');
  return parts[0] === 'wiki' && parts[1] === 'concepts' && parts.length >= 4
    ? parts[2]
    : undefined;
}

function assigned(
  label: string,
  assignment: CommunityAssignment['assignment'],
): CommunityAssignment {
  return { communityId: communityId(label), communityLabel: label, assignment };
}

function winningCommunity(
  candidates: CommunityAssignment[],
  strict: boolean,
): CommunityAssignment | undefined {
  if (candidates.length === 0) return undefined;
  const counts = new Map<string, { count: number; label: string }>();
  for (const candidate of candidates) {
    const current = counts.get(candidate.communityId);
    counts.set(candidate.communityId, {
      count: (current?.count ?? 0) + 1,
      label: current?.label ?? candidate.communityLabel,
    });
  }
  const ranked = [...counts]
    .sort(([idA, a], [idB, b]) => b.count - a.count || idA.localeCompare(idB));
  const winner = ranked[0];
  if (!winner || (strict && winner[1].count <= candidates.length / 2)) return undefined;
  return assigned(winner[1].label, 'inherited');
}

function connectedAssignments(
  nodeId: string,
  edges: WikiGraphEdge[],
  assignments: Map<string, CommunityAssignment>,
  relationTypes: Set<WikiGraphRelationType>,
  neighborFilter: (neighborId: string) => boolean = () => true,
): CommunityAssignment[] {
  const result: CommunityAssignment[] = [];
  const seenNeighbors = new Set<string>();
  for (const edge of edges) {
    if (!relationTypes.has(edge.type)) continue;
    const neighborId = edge.from === nodeId ? edge.to : edge.to === nodeId ? edge.from : null;
    if (!neighborId || seenNeighbors.has(neighborId) || !neighborFilter(neighborId)) continue;
    const community = assignments.get(neighborId);
    if (community) {
      seenNeighbors.add(neighborId);
      result.push(community);
    }
  }
  return result;
}

export function assignGraphCommunities(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  explicitCommunities: Map<string, ExplicitCommunity>,
  fallbackCommunityLabel = 'Ungrouped',
): WikiGraphNode[] {
  const assignments = new Map<string, CommunityAssignment>();

  // Pass 1: explicit frontmatter. `community` precedence is resolved by the
  // projection before this pure assignment function receives the label.
  //
  // On retient QUI a été déclaré par un auteur. Les passes de réparation ne
  // doivent jamais y toucher : le nom d'un dossier est une déduction, une
  // ligne de frontmatter est une décision. La passe 2 marque pourtant les deux
  // « explicit », d'où ce jeu séparé.
  const declared = new Set<string>();
  for (const node of nodes) {
    const explicit = explicitCommunities.get(node.id);
    if (explicit?.label.trim()) {
      assignments.set(node.id, assigned(explicit.label.trim(), 'explicit'));
      declared.add(node.id);
    }
  }

  // Pass 2: concept folder.
  for (const node of nodes) {
    if (assignments.has(node.id)) continue;
    const folder = conceptFolder(node.id);
    if (folder) assignments.set(node.id, assigned(title(folder), 'explicit'));
  }

  // Pass 3: sources inherit the plurality of already-assigned concepts.
  for (const node of nodes) {
    if (assignments.has(node.id) || !['raw-source', 'wiki-source'].includes(node.type)) continue;
    const candidates = connectedAssignments(
      node.id,
      edges.filter((edge) => edge.to === node.id),
      assignments,
      new Set(['generated_from', 'cites']),
      (id) => Boolean(conceptFolder(id)),
    );
    const winner = winningCommunity(candidates, false);
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 4: templates and build contexts require a strict majority.
  for (const node of nodes) {
    if (assignments.has(node.id) || !['template', 'build-context'].includes(node.type)) continue;
    const winner = winningCommunity(
      connectedAssignments(
        node.id,
        edges,
        assignments,
        new Set(['uses_template', 'uses_context', 'produces']),
      ),
      true,
    );
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 5: deliverables inherit the plurality of already-assigned producers.
  for (const node of nodes) {
    if (assignments.has(node.id) || node.type !== 'deliverable') continue;
    const producers = edges
      .filter((edge) => edge.type === 'produces' && edge.to === node.id)
      .map((edge) => assignments.get(edge.from))
      .filter((value): value is CommunityAssignment => Boolean(value));
    const winner = winningCommunity(producers, false);
    if (winner) assignments.set(node.id, winner);
  }

  // Pass 7: propagation jusqu'à stabilisation.
  //
  // Les passes 3 à 5 n'inspectent chacune qu'un type de nœud et ne tournent
  // qu'une fois : une page dont le seul voisin assigné l'a été APRÈS elle
  // restait sans domaine. Répéter jusqu'à ce que plus rien ne bouge coûte
  // quelques itérations et vide l'essentiel du groupe résiduel. Aucun réglage :
  // le critère d'arrêt est l'absence de changement.
  propagateUntilStable(nodes, edges, assignments);

  // Pass 8: absorption des communautés faibles.
  //
  // Une communauté dont les membres ont plus de relations dehors que dedans
  // n'en est pas une : c'est la définition faible de Radicchi. On la fusionne
  // dans le voisinage auquel elle est le plus attachée. Le critère est un
  // rapport, donc il ne dépend ni de la taille du wiki ni d'un seuil choisi
  // pour un corpus particulier — contrairement à un « moins de N pages ».
  absorbWeakCommunities(nodes, edges, assignments, declared);

  // Pass 9: dissolution des communautés sans cohésion interne.
  //
  // La passe précédente ne peut rien contre un dossier d'une seule page, sans
  // aucun lien : ni relation interne, ni relation externe, donc aucun déficit
  // à mesurer. C'est pourtant le cas le plus visible à l'écran — la moitié des
  // halos du graphe portaient « 1 page ». Une communauté sans AUCUNE relation
  // interne n'en est pas une : c'est un nom de dossier. On la dissout et on
  // replace ses membres un par un.
  dissolveCommunitiesWithoutCohesion(nodes, edges, assignments, declared);

  // Pass 10: pages isolées, rattachées par le vocabulaire.
  //
  // Ce qui reste n'a aucune relation : la topologie ne peut plus rien en dire.
  // Le vocabulaire, lui, est mesurable — et il vient du corpus lui-même, pas
  // d'une liste de thèmes écrite à l'avance qui ne survivrait pas au prochain
  // wiki.
  attachIsolatedByVocabulary(nodes, assignments);

  // Pass 10: stable fallback id, configurable display label.
  return nodes.map((node) => ({
    ...node,
    community: assignments.get(node.id) ?? {
      communityId: 'ungrouped',
      communityLabel: fallbackCommunityLabel,
      assignment: 'fallback',
    },
  }));
}

/** Voisins d'un nœud, tous types de relation confondus. */
function neighbourMap(edges: WikiGraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from)!.add(to);
  };
  for (const edge of edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return map;
}

function propagateUntilStable(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  assignments: Map<string, CommunityAssignment>,
): void {
  const neighbours = neighbourMap(edges);
  // Borne de sûreté : la propagation converge, mais un graphe pathologique ne
  // doit pas pouvoir faire tourner le rendu indéfiniment.
  for (let round = 0; round < nodes.length; round += 1) {
    let changed = 0;
    for (const node of nodes) {
      if (assignments.has(node.id)) continue;
      const candidates: CommunityAssignment[] = [];
      for (const neighbour of neighbours.get(node.id) ?? []) {
        const community = assignments.get(neighbour);
        if (community) candidates.push(community);
      }
      // Même exigence qu'à la passe 4 : un gabarit ou un contexte de build
      // utilisé à parts égales par deux domaines n'appartient à aucun. La
      // propagation ne doit pas contourner cette règle sous prétexte qu'elle
      // repasse plus tard.
      const strict = node.type === 'template' || node.type === 'build-context';
      const winner = winningCommunity(candidates, strict);
      if (winner) {
        assignments.set(node.id, winner);
        changed += 1;
      }
    }
    if (!changed) return;
  }
}

function absorbWeakCommunities(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  assignments: Map<string, CommunityAssignment>,
  declared: ReadonlySet<string>,
): void {
  const neighbours = neighbourMap(edges);
  for (let round = 0; round < nodes.length; round += 1) {
    const members = new Map<string, string[]>();
    for (const node of nodes) {
      const id = assignments.get(node.id)?.communityId;
      if (!id) continue;
      if (!members.has(id)) members.set(id, []);
      members.get(id)!.push(node.id);
    }
    if (members.size < 2) return;

    let weakest: { id: string; deficit: number } | undefined;
    for (const [id, ids] of members) {
      let inside = 0;
      let outside = 0;
      for (const nodeId of ids) {
        for (const neighbour of neighbours.get(nodeId) ?? []) {
          if (assignments.get(neighbour)?.communityId === id) inside += 1;
          else if (assignments.has(neighbour)) outside += 1;
        }
      }
      const deficit = outside - inside;
      if (deficit > 0 && (!weakest || deficit > weakest.deficit)) weakest = { id, deficit };
    }
    if (!weakest) return;

    const absorbed = members.get(weakest.id) ?? [];
    // Attachement RELATIF, pas pluralité brute.
    //
    // Compter les voix favorise le plus gros voisin : il en a davantage du seul
    // fait de sa taille. Chaque absorption le grossit, ce qui rend la suivante
    // plus probable — et l'on remplace la dispersion par un unique fourre-tout,
    // qui n'informe pas davantage. Diviser par la taille compare la densité du
    // rattachement plutôt que son volume.
    const votes = new Map<string, { community: CommunityAssignment; count: number }>();
    for (const nodeId of absorbed) {
      for (const neighbour of neighbours.get(nodeId) ?? []) {
        const community = assignments.get(neighbour);
        if (!community || community.communityId === weakest.id) continue;
        const current = votes.get(community.communityId);
        votes.set(community.communityId, { community, count: (current?.count ?? 0) + 1 });
      }
    }
    let winner: CommunityAssignment | undefined;
    let bestDensity = 0;
    for (const [id, vote] of [...votes].sort(([a], [b]) => a.localeCompare(b))) {
      const density = vote.count / Math.max(1, (members.get(id) ?? []).length);
      if (density > bestDensity) {
        bestDensity = density;
        winner = { ...vote.community, assignment: 'inherited' };
      }
    }
    if (!winner) return;
    let moved = 0;
    for (const nodeId of absorbed) {
      if (declared.has(nodeId)) continue;
      assignments.set(nodeId, winner);
      moved += 1;
    }
    // Une communauté entièrement déclarée par ses auteurs ne bougera jamais :
    // sans cette sortie, la boucle la réélirait indéfiniment comme la plus
    // faible.
    if (!moved) return;
  }
}

function dissolveCommunitiesWithoutCohesion(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  assignments: Map<string, CommunityAssignment>,
  declared: ReadonlySet<string>,
): void {
  const neighbours = neighbourMap(edges);
  const members = new Map<string, string[]>();
  for (const node of nodes) {
    const id = assignments.get(node.id)?.communityId;
    if (!id) continue;
    if (!members.has(id)) members.set(id, []);
    members.get(id)!.push(node.id);
  }
  if (members.size < 2) return;

  for (const [id, ids] of members) {
    // Une communauté nommée explicitement par l'auteur reste intacte, même
    // sans cohésion mesurable : c'est une décision, pas une déduction.
    if (ids.some((nodeId) => declared.has(nodeId))) continue;
    let inside = 0;
    for (const nodeId of ids) {
      for (const neighbour of neighbours.get(nodeId) ?? []) {
        if (assignments.get(neighbour)?.communityId === id) inside += 1;
      }
    }
    if (inside > 0) continue;
    for (const nodeId of ids) assignments.delete(nodeId);
  }
}

/** Termes porteurs d'une page, pondérés par leur rareté dans le corpus. */
function vocabularyVectors(nodes: WikiGraphNode[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const documentFrequency = new Map<string, number>();
  for (const node of nodes) {
    const words = `${node.title} ${node.raw ?? node.preview ?? ''}`
      .toLowerCase()
      .match(/\p{L}{5,}/gu) ?? [];
    const local = new Map<string, number>();
    for (const word of words) local.set(word, (local.get(word) ?? 0) + 1);
    counts.set(node.id, local);
    for (const word of local.keys()) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }

  const total = Math.max(1, nodes.length);
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, local] of counts) {
    const weighted: Array<[string, number]> = [];
    for (const [word, n] of local) {
      const df = documentFrequency.get(word) ?? 0;
      // Un mot présent dans une seule page ne peut rapprocher de rien : il
      // n'entre dans aucun produit scalaire et ne ferait qu'occuper la place
      // des termes partagés.
      //
      // En revanche, pas de borne haute. Une coupure du genre « df > moitié du
      // corpus » paraît raisonnable et devient destructrice sur un petit wiki :
      // à cinq pages, elle éliminait absolument tous les termes. L'IDF fait
      // déjà ce travail sans réglage — un mot présent partout pèse log(1) = 0.
      if (df <= 1) continue;
      weighted.push([word, (1 + Math.log(n)) * Math.log(total / df)]);
    }
    weighted.sort((a, b) => b[1] - a[1]);
    const top = weighted.slice(0, 60);
    const norm = Math.sqrt(top.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
    vectors.set(id, new Map(top.map(([word, value]) => [word, value / norm])));
  }
  return vectors;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let total = 0;
  for (const [word, weight] of small) total += weight * (large.get(word) ?? 0);
  return total;
}

function attachIsolatedByVocabulary(
  nodes: WikiGraphNode[],
  assignments: Map<string, CommunityAssignment>,
): void {
  const orphans = nodes.filter((node) => !assignments.has(node.id));
  if (!orphans.length || orphans.length === nodes.length) return;

  const vectors = vocabularyVectors(nodes);
  for (const orphan of orphans) {
    const own = vectors.get(orphan.id);
    if (!own?.size) continue;
    let best: { community: CommunityAssignment; score: number } | undefined;
    for (const node of nodes) {
      const community = assignments.get(node.id);
      if (!community) continue;
      const score = cosine(own, vectors.get(node.id) ?? new Map());
      if (!best || score > best.score) best = { community, score };
    }
    // Une page qui ne ressemble à rien reste sans domaine : la ranger de force
    // dans le plus proche par défaut ferait entrer du bruit dans un domaine
    // qui, lui, a un sens.
    if (best && best.score > 0) {
      assignments.set(orphan.id, { ...best.community, assignment: 'inherited' });
    }
  }
}

function isConcept(node: WikiGraphNode): boolean {
  return Boolean(conceptFolder(node.id));
}

function isSource(type: WikiGraphNodeType): boolean {
  return type === 'raw-source' || type === 'wiki-source';
}

export function topologyEtag(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
): string {
  const nodeIds = nodes.map((node) => node.id).sort();
  const edgeTuples = edges
    .map((edge) => [edge.from, edge.to, edge.type] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const assignmentTuples = nodes
    .map((node) => [node.id, node.community.communityId] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha1')
    .update(JSON.stringify([nodeIds, edgeTuples, assignmentTuples]))
    .digest('hex');
}

export function createCommunityProjection(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
): CommunityProjection {
  const buckets = new Map<string, WikiGraphNode[]>();
  for (const node of nodes) {
    const bucket = buckets.get(node.community.communityId) ?? [];
    bucket.push(node);
    buckets.set(node.community.communityId, bucket);
  }

  const communityByNode = new Map(nodes.map((node) => [node.id, node.community.communityId]));
  const internalCounts = new Map<string, number>();
  const externalCounts = new Map<string, number>();
  const aggregate = new Map<string, WikiGraphCommunityEdge>();
  for (const edge of edges) {
    const from = communityByNode.get(edge.from);
    const to = communityByNode.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      internalCounts.set(from, (internalCounts.get(from) ?? 0) + 1);
      continue;
    }
    externalCounts.set(from, (externalCounts.get(from) ?? 0) + 1);
    externalCounts.set(to, (externalCounts.get(to) ?? 0) + 1);
    const key = JSON.stringify([from, to]);
    const current = aggregate.get(key) ?? { from, to, count: 0, relations: {} };
    current.count += 1;
    current.relations[edge.type] = (current.relations[edge.type] ?? 0) + 1;
    aggregate.set(key, current);
  }

  const communities = [...buckets].map(([id, members]): WikiGraphCommunity => {
    const sortedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id));
    return {
      id,
      label: sortedMembers[0]?.community.communityLabel ?? id,
      nodeIds: sortedMembers.map((node) => node.id),
      documentCount: sortedMembers.length,
      conceptCount: sortedMembers.filter(isConcept).length,
      sourceCount: sortedMembers.filter((node) => isSource(node.type)).length,
      internalRelations: internalCounts.get(id) ?? 0,
      externalRelations: externalCounts.get(id) ?? 0,
    };
  }).sort((a, b) => b.documentCount - a.documentCount || a.label.localeCompare(b.label));

  const communityEdges = [...aggregate.values()]
    .map((edge) => ({
      ...edge,
      relations: Object.fromEntries(
        Object.entries(edge.relations).sort(([a], [b]) => a.localeCompare(b)),
      ) as Partial<Record<WikiGraphRelationType, number>>,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    communities,
    communityEdges,
    topologyEtag: topologyEtag(nodes, edges),
  };
}
