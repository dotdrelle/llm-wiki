import { describe, expect, it } from 'vitest';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import { graphUiSelectionScript } from '../src/graph/wiki/ui/core/selectionScript.ts';
import { graphUiFiltersScript } from '../src/graph/wiki/ui/core/filtersScript.ts';
import { graphAppScript } from '../src/graph/wiki/ui/script.ts';
import { communityHierarchy } from '../src/graph/wiki/taxonomy/lookup.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import { withCoverage } from './support/registryCoverage.ts';

const canvas = canvasExplorerScript();
const selection = graphUiSelectionScript();

function registry(): TaxonomyRegistry {
  return withCoverage({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 3,
    corpus: 'sha1:abc',
    languages: ['fr'],
    communities: [
      { id: 'dom_logiciel', prefLabel: { fr: 'Logiciel' }, firstSeenRevision: 1, parentCommunity: null },
      { id: 'cmty_anaplan', prefLabel: { fr: 'Anaplan' }, firstSeenRevision: 1, parentCommunity: 'dom_logiciel' },
      { id: 'cmty_board', prefLabel: { fr: 'Board' }, firstSeenRevision: 1, parentCommunity: 'dom_logiciel' },
      { id: 'cmty_seul', prefLabel: { fr: 'Isole' }, firstSeenRevision: 1, parentCommunity: null },
    ],
    assignments: {
      'wiki/a.md': { primaryCommunity: 'cmty_anaplan' },
      'wiki/b.md': { primaryCommunity: 'cmty_board' },
      'wiki/c.md': { primaryCommunity: 'cmty_seul' },
    },
  });
}

describe('arbre exposé au client', () => {
  it('donne les domaines et le parent de chaque feuille', () => {
    const tree = communityHierarchy(registry(), 'fr');

    expect(tree.domains).toEqual([{ id: 'dom_logiciel', label: 'Logiciel' }]);
    expect(tree.parents).toEqual({ cmty_anaplan: 'dom_logiciel', cmty_board: 'dom_logiciel' });
  });

  it('ne présente pas comme domaine une racine sans enfant', () => {
    // `cmty_seul` est une racine, mais elle porte des pages : c'est une
    // feuille, et la carte doit l'afficher telle quelle.
    expect(communityHierarchy(registry(), 'fr').domains.map((item) => item.id)).not.toContain('cmty_seul');
  });

  it('reste vide sur une taxonomie déterministe', () => {
    const flat = registry();
    flat.communities = flat.communities.map((item) => ({ ...item, parentCommunity: null }));

    const tree = communityHierarchy(flat, 'fr');
    // La carte retombe alors sur son rendu plat, ce qui est correct : aucun
    // domaine n'existe.
    expect(tree.domains).toEqual([]);
    expect(tree.parents).toEqual({});
  });

  it('rend le libellé du domaine dans la langue demandée', () => {
    const data = registry();
    data.communities[0]!.prefLabel = { fr: 'Logiciel', en: 'Software' };

    expect(communityHierarchy(data, 'en').domains[0]!.label).toBe('Software');
  });
});

describe('navigation carte → domaine → communauté → document', () => {
  /*
   Le niveau qui manquait. Sans lui, la carte affichait autant de bulles qu'il
   y a de sujets, et ouvrir un domaine déversait toutes ses pages d'un coup.
  */
  it('replie les feuilles sous leur domaine sur la carte', () => {
    expect(canvas).toContain('function canvasExplorerRollUp(communities)');
    // Les comptes d'un domaine sont la somme de ses feuilles, jamais des pages
    // qui lui seraient accrochées en propre — il n'en a aucune.
    expect(canvas).toContain('current.documentCount+=item.documentCount');
    // Le repli reçoit désormais les communautés RESTREINTES aux pages visibles :
    // une bulle qui compte des pages masquées par les filtres ment sur ce
    // qu'elle contient.
    expect(canvas).toContain('canvasExplorerRollUp(canvasExplorerVisibleCommunities(ids))');
    expect(canvas).toContain('item.nodeIds.filter(id=>ids.has(id))');
  });

  it('n’altère rien quand aucun domaine n’existe', () => {
    expect(canvas).toContain('if(!domains.length)return communities');
  });

  it('montre les communautés d’un domaine une fois qu’on y est descendu', () => {
    expect(canvas).toContain("if(view==='domain'&&selectedCommunity)return communities.filter(item=>parents[item.id]===selectedCommunity)");
    // Le niveau domaine reste une carte : des communautés, pas des documents.
    expect(canvas).toContain("view==='map'||view==='domain'?canvasExplorerSceneMap()");
  });

  it('ouvre un domaine sur ses communautés, jamais sur ses documents', () => {
    // La résolution parent→filles vit désormais dans les helpers, partagée avec
    // `visible()` et l'index : c'est leur divergence qui avait vidé la vue.
    expect(selection).toContain('const children=graphCommunityChildren(id)');
    expect(selection).toContain('if(children.length){');
    expect(selection).toContain("view='domain'");
    // Chaque enfant est cliquable et redescend d'un cran.
    expect(selection).toContain('data-community="');
  });

  it('laisse une feuille ouvrir ses documents comme avant', () => {
    // La branche hiérarchique sort tôt ; le chemin d'origine reste intact pour
    // une communauté sans enfant.
    const after = selection.slice(selection.indexOf('const community=data.communities.find'));
    expect(after).toContain("view='community'");
    expect(after).toContain('document-focus-list');
  });

  it('nomme le nouveau niveau dans le titre de la vue', () => {
    expect(graphAppScript).toContain("domain:'Domain view'");
  });
});

/*
 La hiérarchie doit être visible PARTOUT, pas seulement sur la carte.

 Sur ACPI, le registre était hiérarchique et la carte repliait, mais l'index de
 gauche listait toujours 33 feuilles à plat et l'en-tête annonçait « 33
 communities » sur une carte qui en montrait 3. Deux représentations
 contradictoires du même corpus dans la même fenêtre sont pires qu'aucune
 hiérarchie.
*/
describe('cohérence de l’arbre dans toute l’interface', () => {
  const filters = graphUiFiltersScript();

  it('replie aussi les liens, sinon la carte n’a aucune arête', () => {
    // Les arêtes relient des feuilles : sans réécriture vers le niveau
    // affiché, aucune ne correspond plus à une bulle visible.
    expect(canvas).toContain('function canvasExplorerRollUpEdges(visibleIds)');
    expect(canvas).toContain('edges:canvasExplorerRollUpEdges(visibleIds)');
    // Une relation interne à un domaine ne dit rien à son niveau.
    expect(canvas).toContain('if(!from||!to||from===to)return');
    // Les doublons s'agrègent au lieu de se superposer.
    expect(canvas).toContain('current.weight+=edge.count');
  });

  it('rend l’index de gauche arborescent', () => {
    expect(filters).toContain('function renderCommunityIndex()');
    expect(filters).toContain('community-domain');
    expect(filters).toContain('community-children');
    // Une racine sans enfant reste visible au rang des domaines.
    expect(filters).toContain('const orphans=data.communities.filter');
  });

  it('garde l’index plat quand aucun domaine n’existe', () => {
    expect(filters).toContain("if(!domains.length)return data.communities.map((c,i)=>communityGroupHtml(c,i)).join('')");
  });

  it('compte ce qui est affiché, pas ce que contient le registre', () => {
    expect(graphAppScript).toContain("const unit=domains.length&&view==='map'?' domains · ':' communities · '");
    expect(graphAppScript).toContain('parents[community.id]||community.id');
  });
});
