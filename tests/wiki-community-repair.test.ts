import { describe, expect, it } from 'vitest';
import { assignGraphCommunities } from '../src/graph/wiki/communityProjection.ts';
import type { WikiGraphEdge, WikiGraphNode, WikiGraphNodeType } from '../src/graph/wiki/projection.ts';

function node(id: string, type: WikiGraphNodeType = 'wiki', raw = ''): WikiGraphNode {
  return {
    id,
    title: id,
    type,
    href: id,
    preview: '',
    raw,
    html: '',
    community: { communityId: '', communityLabel: '', assignment: 'fallback' },
    degree: 0,
    x: 0,
    y: 0,
    r: 0,
    ring: 0,
    secondary: '',
    inbound: 0,
    outbound: 0,
  };
}

const link = (from: string, to: string): WikiGraphEdge => ({ from, to, type: 'related_to' } as WikiGraphEdge);
const communities = (assigned: WikiGraphNode[]) => {
  const sizes = new Map<string, number>();
  for (const item of assigned) {
    sizes.set(item.community.communityId, (sizes.get(item.community.communityId) ?? 0) + 1);
  }
  return sizes;
};

describe('réparation des communautés', () => {
  it('propage jusqu’à stabilisation, sans dépendre de l’ordre des passes', () => {
    // b n'a pour voisin que c, lui-même rattaché après lui. Une passe unique
    // laissait b sans domaine ; la propagation le récupère au tour suivant.
    const nodes = [
      node('wiki/concepts/alpha/a.md'),
      node('wiki/loose-b.md'),
      node('wiki/loose-c.md'),
    ];
    const edges = [link('wiki/loose-b.md', 'wiki/loose-c.md'), link('wiki/loose-c.md', 'wiki/concepts/alpha/a.md')];

    const assigned = assignGraphCommunities(nodes, edges, new Map());
    for (const item of assigned) expect(item.community.communityId).toBe('alpha');
  });

  it('absorbe une communauté plus liée dehors que dedans', () => {
    // « beta » n'a aucune relation interne et trois vers alpha : ce n'est pas
    // une communauté, c'est un nom de dossier. Critère de Radicchi, donc sans
    // seuil de taille arbitraire.
    const nodes = [
      node('wiki/concepts/alpha/a.md'),
      node('wiki/concepts/alpha/b.md'),
      node('wiki/concepts/alpha/c.md'),
      node('wiki/concepts/beta/x.md'),
    ];
    const edges = [
      link('wiki/concepts/alpha/a.md', 'wiki/concepts/alpha/b.md'),
      link('wiki/concepts/alpha/b.md', 'wiki/concepts/alpha/c.md'),
      link('wiki/concepts/beta/x.md', 'wiki/concepts/alpha/a.md'),
      link('wiki/concepts/beta/x.md', 'wiki/concepts/alpha/b.md'),
      link('wiki/concepts/beta/x.md', 'wiki/concepts/alpha/c.md'),
    ];

    const sizes = communities(assignGraphCommunities(nodes, edges, new Map()));
    expect(sizes.get('alpha')).toBe(4);
    expect(sizes.has('beta')).toBe(false);
  });

  it('préfère le rattachement le plus dense, pas le plus gros voisin', () => {
    // Sans normalisation par la taille, « big » gagnerait par son seul volume,
    // grossirait encore, et absorberait tout le wiki de proche en proche.
    const nodes = [
      ...['1', '2', '3', '4', '5', '6'].map((n) => node(`wiki/concepts/big/${n}.md`)),
      node('wiki/concepts/small/1.md'),
      node('wiki/concepts/small/2.md'),
      node('wiki/concepts/weak/x.md'),
    ];
    const edges = [
      link('wiki/concepts/big/1.md', 'wiki/concepts/big/2.md'),
      link('wiki/concepts/small/1.md', 'wiki/concepts/small/2.md'),
      // deux voix vers big (6 membres), deux vers small (2 membres) :
      // même volume, densité quatre fois supérieure côté small.
      link('wiki/concepts/weak/x.md', 'wiki/concepts/big/1.md'),
      link('wiki/concepts/weak/x.md', 'wiki/concepts/big/2.md'),
      link('wiki/concepts/weak/x.md', 'wiki/concepts/small/1.md'),
      link('wiki/concepts/weak/x.md', 'wiki/concepts/small/2.md'),
    ];

    const assigned = assignGraphCommunities(nodes, edges, new Map());
    const weak = assigned.find((item) => item.id === 'wiki/concepts/weak/x.md');
    expect(weak?.community.communityId).toBe('small');
  });

  it('rattache une page sans aucun lien par son vocabulaire', () => {
    // La topologie ne dit rien d'une page isolée. Le vocabulaire vient du
    // corpus, pas d'une liste de thèmes écrite d'avance.
    const nodes = [
      node('wiki/concepts/reseau/a.md', 'wiki', 'routeur commutateur passerelle routage réseau'),
      node('wiki/concepts/reseau/b.md', 'wiki', 'routeur passerelle routage commutateur réseau'),
      node('wiki/concepts/cuisine/a.md', 'wiki', 'casserole cuisson friture assaisonnement cuisine'),
      node('wiki/concepts/cuisine/b.md', 'wiki', 'casserole cuisson friture assaisonnement cuisine'),
      node('wiki/orpheline.md', 'wiki', 'routeur commutateur passerelle routage réseau'),
    ];
    const edges = [
      link('wiki/concepts/reseau/a.md', 'wiki/concepts/reseau/b.md'),
      link('wiki/concepts/cuisine/a.md', 'wiki/concepts/cuisine/b.md'),
    ];

    const assigned = assignGraphCommunities(nodes, edges, new Map());
    const orphan = assigned.find((item) => item.id === 'wiki/orpheline.md');
    expect(orphan?.community.communityId).toBe('reseau');
  });

  it('ne touche jamais à une communauté déclarée en frontmatter', () => {
    // Le nom d'un dossier est une déduction, une ligne de frontmatter est une
    // décision. Les réparations n'ont pas à la corriger.
    const nodes = [
      node('wiki/concepts/alpha/a.md'),
      node('wiki/concepts/alpha/b.md'),
      node('wiki/declaree.md'),
    ];
    const edges = [
      link('wiki/concepts/alpha/a.md', 'wiki/concepts/alpha/b.md'),
      link('wiki/declaree.md', 'wiki/concepts/alpha/a.md'),
      link('wiki/declaree.md', 'wiki/concepts/alpha/b.md'),
    ];
    const explicit = new Map([['wiki/declaree.md', { label: 'Choix auteur' }]]);

    const assigned = assignGraphCommunities(nodes, edges, explicit);
    const declared = assigned.find((item) => item.id === 'wiki/declaree.md');
    expect(declared?.community.communityId).toBe('choix-auteur');
    expect(declared?.community.assignment).toBe('explicit');
  });

  it('laisse sans domaine ce qui ne ressemble à rien', () => {
    // Ranger de force une page dans le domaine « le moins éloigné » ferait
    // entrer du bruit dans un domaine qui, lui, a un sens.
    const nodes = [
      node('wiki/concepts/reseau/a.md', 'wiki', 'routeur commutateur passerelle'),
      node('wiki/concepts/reseau/b.md', 'wiki', 'routeur commutateur passerelle'),
      node('wiki/vide.md', 'wiki', ''),
    ];
    const edges = [link('wiki/concepts/reseau/a.md', 'wiki/concepts/reseau/b.md')];

    const assigned = assignGraphCommunities(nodes, edges, new Map());
    const empty = assigned.find((item) => item.id === 'wiki/vide.md');
    expect(empty?.community.assignment).toBe('fallback');
  });
});
