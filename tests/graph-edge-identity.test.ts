import { describe, expect, it } from 'vitest';
import { createSnapshot, graphEdgeId } from '../src/graph/wiki/snapshot.ts';
import type { WikiGraphEdge, WikiGraphNode } from '../src/graph/wiki/projection.ts';

function node(id: string, group = 'Domaine'): WikiGraphNode {
  return {
    id,
    title: id,
    type: 'wiki',
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    group,
    community: { communityId: 'domaine', communityLabel: group, assignment: 'explicit' },
    degree: 1,
    x: 0,
    y: 0,
    r: 10,
    ring: 1,
    secondary: id,
    inbound: 0,
    outbound: 1,
  };
}

const edge = (from: string, to: string, type: WikiGraphEdge['type'] = 'links_to'): WikiGraphEdge =>
  ({ from, to, type });

describe('identifiant d’arête', () => {
  /*
   Le défaut que ce lot corrige. `rel-${index}` renumérotait toutes les arêtes
   suivantes dès qu'une page était insérée — donc à chaque ingestion. Une
   relation qui persiste devenait indistinguable d'une relation nouvelle ayant
   hérité du numéro d'une autre, et aucune continuité d'animation n'était
   calculable d'une révision à l'autre.
  */
  it('ne change pas quand une arête est insérée avant lui', () => {
    const nodes = ['a.md', 'b.md', 'c.md'].map((id) => node(id));
    const before = createSnapshot('etag-1', {
      nodes,
      edges: [edge('a.md', 'b.md'), edge('b.md', 'c.md')],
    });

    const after = createSnapshot('etag-2', {
      nodes: [...nodes, node('z.md')],
      // La nouvelle arête arrive EN TÊTE : avec un identifiant positionnel,
      // toutes les suivantes se décalaient.
      edges: [edge('z.md', 'a.md'), edge('a.md', 'b.md'), edge('b.md', 'c.md')],
    });

    const persisted = before.edges.map((item) => item.id);
    for (const id of persisted) {
      expect(after.edges.some((item) => item.id === id)).toBe(true);
    }
    // Et la nouvelle est bien nouvelle.
    expect(after.edges).toHaveLength(3);
    expect(new Set(after.edges.map((item) => item.id)).size).toBe(3);
  });

  it('distingue le sens et le type d’une même paire', () => {
    expect(graphEdgeId(edge('a.md', 'b.md'))).not.toBe(graphEdgeId(edge('b.md', 'a.md')));
    expect(graphEdgeId(edge('a.md', 'b.md', 'links_to')))
      .not.toBe(graphEdgeId(edge('a.md', 'b.md', 'cites')));
  });

  it('est stable d’un calcul à l’autre', () => {
    expect(graphEdgeId(edge('a.md', 'b.md'))).toBe(graphEdgeId(edge('a.md', 'b.md')));
  });

  it('reste court, car il voyage dans chaque snapshot', () => {
    // Les chemins relatifs complets pèseraient bien plus que 16 caractères, et
    // ils repartent en entier à chaque révision.
    const id = graphEdgeId(edge('wiki/concepts/un-domaine-au-nom-long/une-page.md', 'wiki/autre.md'));
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ne collisionne pas sur un corpus de taille réaliste', () => {
    const nodes: WikiGraphNode[] = [];
    const edges: WikiGraphEdge[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const id = `wiki/concepts/domaine-${index % 12}/page-${index}.md`;
      nodes.push(node(id));
      if (index > 0) edges.push(edge(nodes[index - 1]!.id, id));
      if (index % 5 === 0 && index > 0) edges.push(edge(id, nodes[0]!.id, 'cites'));
    }
    const snapshot = createSnapshot('etag', { nodes, edges });

    expect(new Set(snapshot.edges.map((item) => item.id)).size).toBe(snapshot.edges.length);
  });
});
