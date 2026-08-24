import { describe, expect, it } from 'vitest';
import { graphUiHelpersScript } from '../src/graph/wiki/ui/core/helpersScript.ts';
import { graphUiFiltersScript } from '../src/graph/wiki/ui/core/filtersScript.ts';

/*
 Ce fichier existe parce qu'un test de chaîne de caractères a laissé passer la
 panne.

 `graph-hierarchy-navigation.test.ts` vérifiait que le repli, l'index
 arborescent et le niveau « domaine » étaient bien ÉCRITS dans le script. Ils
 l'étaient. Et pourtant ouvrir un domaine rendait un canevas vide et l'index de
 gauche disparaissait entièrement, parce que `data.communities` ne contient que
 des FEUILLES : y chercher un identifiant de domaine ne renvoie rien, et « rien »
 était traité comme « aucun membre » alors qu'un domaine en a plus qu'une
 feuille, pas moins.

 Aucune lecture du source ne pouvait dire cela. On exécute donc les fonctions,
 avec un DOM réduit à ce qu'elles interrogent vraiment.
*/

type Community = { id: string; label: string; nodeIds: string[]; documentCount: number };

const SCRIPT = graphUiHelpersScript() + graphUiFiltersScript();

const DATA = {
  workspace: 'demo',
  domains: [{ id: 'dom_demo', label: 'demo' }],
  communityParents: { cmty_evaluation: 'dom_demo', cmty_branches: 'dom_demo' },
  communities: [
    { id: 'cmty_evaluation', label: 'evaluation', nodeIds: ['wiki/a.md', 'wiki/b.md'], documentCount: 2 },
    { id: 'cmty_branches', label: 'branches', nodeIds: ['wiki/c.md'], documentCount: 1 },
    { id: 'cmty_isole', label: 'isole', nodeIds: ['wiki/d.md'], documentCount: 1 },
  ] as Community[],
  nodes: [
    { id: 'wiki/a.md', type: 'wiki', title: 'A', degree: 1 },
    { id: 'wiki/b.md', type: 'wiki', title: 'B', degree: 1 },
    { id: 'wiki/c.md', type: 'wiki', title: 'C', degree: 1 },
    { id: 'wiki/d.md', type: 'wiki', title: 'D', degree: 0 },
  ],
  edges: [{ id: 'e1', from: 'wiki/a.md', to: 'wiki/b.md', type: 'link' }],
};

/** Élément de groupe réduit aux propriétés que `updateCommunityFilterCounts` touche. */
function groupElement(id: string) {
  const summary = { dataset: { community: id }, classList: { toggle() {} } };
  const counter = { textContent: '' };
  return {
    id,
    hidden: false,
    open: false,
    querySelector(selector: string) {
      if (selector === '[data-community]') return summary;
      if (selector === 'summary b') return counter;
      return null;
    },
    querySelectorAll() {
      return [] as unknown[];
    },
    counter,
  };
}

function evaluate(options: { view: string; selectedCommunity: string | null; enabledTypes?: string[]; groups?: string[] }) {
  const groups = (options.groups ?? []).map(groupElement);
  const checked = (options.enabledTypes ?? ['wiki']).map((type) => ({ dataset: { type } }));
  const document = {
    querySelectorAll(selector: string) {
      if (selector === '[data-type]:checked') return checked;
      if (selector === '.community-group') return groups;
      return [];
    },
    querySelector() {
      return null;
    },
  };
  const factory = new Function(
    'document',
    'data',
    'view',
    'selected',
    'selectedCommunity',
    `${SCRIPT}\nreturn { visible, graphCommunityMembers, graphRelationsLabel, graphCommunityLabel, updateCommunityFilterCounts };`,
  );
  const api = factory(document, DATA, options.view, null, options.selectedCommunity);
  return { api, groups };
}

describe('périmètre d’un identifiant de la taxonomie', () => {
  it('rend les pages d’une feuille', () => {
    const { api } = evaluate({ view: 'community', selectedCommunity: 'cmty_evaluation' });

    expect(api.graphCommunityMembers('cmty_evaluation')).toEqual(['wiki/a.md', 'wiki/b.md']);
  });

  /*
   Le cœur du correctif. Un domaine ne porte aucune page en propre : ses membres
   sont l'union de ceux de ses filles. Chercher son identifiant dans la liste
   des feuilles renvoyait `undefined`, donc l'ensemble vide.
  */
  it('rend l’union des pages des filles pour un domaine', () => {
    const { api } = evaluate({ view: 'domain', selectedCommunity: 'dom_demo' });

    expect(api.graphCommunityMembers('dom_demo').sort()).toEqual(['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
  });

  it('rend un ensemble vide pour un identifiant inconnu', () => {
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.graphCommunityMembers('cmty_absent')).toEqual([]);
  });

  it('nomme aussi bien un domaine qu’une feuille', () => {
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.graphCommunityLabel('dom_demo')).toBe('demo');
    expect(api.graphCommunityLabel('cmty_branches')).toBe('branches');
  });
});

describe('vue d’un domaine', () => {
  /*
   Le symptôme observé : « Domain view — 0 communities · 0 documents · 0
   relations », canevas noir, alors que le panneau de droite listait
   correctement les huit communautés du domaine. Le panneau lisait l'arbre ;
   la scène passait par `visible()`.
  */
  it('contient les documents de toutes ses filles', () => {
    const { api } = evaluate({ view: 'domain', selectedCommunity: 'dom_demo' });
    const scope = api.visible();

    expect(scope.nodes.map((node: { id: string }) => node.id).sort()).toEqual(['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
    expect(scope.edges).toHaveLength(1);
  });

  it('reste restreint à la feuille quand on descend d’un cran', () => {
    const { api } = evaluate({ view: 'community', selectedCommunity: 'cmty_branches' });

    expect(api.visible().nodes.map((node: { id: string }) => node.id)).toEqual(['wiki/c.md']);
  });

  it('montre tout le corpus sur la carte', () => {
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.visible().nodes).toHaveLength(4);
  });
});

describe('index de gauche', () => {
  /*
   Deuxième visage de la même faute. Le groupe d'un domaine porte un
   identifiant de domaine : ne le trouvant pas parmi les feuilles, la fonction
   lui comptait zéro membre et le masquait — avec toutes ses filles, qui sont
   imbriquées dedans. La colonne « COMMUNITIES » se vidait donc entièrement.
  */
  it('garde visible le groupe d’un domaine', () => {
    const { api, groups } = evaluate({
      view: 'map',
      selectedCommunity: null,
      groups: ['dom_demo', 'cmty_evaluation', 'cmty_branches', 'cmty_isole'],
    });
    api.updateCommunityFilterCounts();

    expect(groups.map((group) => group.hidden)).toEqual([false, false, false, false]);
    expect(groups[0]!.counter.textContent).toBe('3');
    expect(groups[1]!.counter.textContent).toBe('2');
  });

  it('masque un groupe que les filtres de type vident réellement', () => {
    const { api, groups } = evaluate({
      view: 'map',
      selectedCommunity: null,
      enabledTypes: ['deliverable'],
      groups: ['dom_demo', 'cmty_isole'],
    });
    api.updateCommunityFilterCounts();

    // Aucun document du corpus n'est de ce type : là, masquer est exact.
    expect(groups.map((group) => group.hidden)).toEqual([true, true]);
  });
});

describe('compteur de relations', () => {
  /*
   « 1 relation » sous une bulle qui en montre visiblement une occupe la ligne
   où l'on lit le type du document sans rien y ajouter.
  */
  it('se tait quand le lien unique est déjà à l’écran', () => {
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.graphRelationsLabel(1)).toBe('');
  });

  it('parle dès qu’on ne peut plus compter d’un coup d’œil', () => {
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.graphRelationsLabel(2)).toBe('2 relations');
    expect(api.graphRelationsLabel(9)).toBe('9 relations');
  });

  it('dit l’isolement, qui ne se voit pas', () => {
    // Zéro relation ne dessine rien : c'est le seul cas où le compteur est la
    // seule source de l'information.
    const { api } = evaluate({ view: 'map', selectedCommunity: null });

    expect(api.graphRelationsLabel(0)).toBe('0 relations');
    expect(api.graphRelationsLabel(undefined)).toBe('0 relations');
  });
});
