import { describe, expect, it } from 'vitest';
import { graphUiSelectionScript } from '../src/graph/wiki/ui/core/selectionScript.ts';
import { graphAppScript } from '../src/graph/wiki/ui/script.ts';

/*
 Un filtre de type gouverne TROIS surfaces : l'index de gauche, le canevas et le
 panneau de droite.

 La troisième manquait. `selectCommunity` filtrait bien, mais au moment du clic
 seulement : le gestionnaire de changement de filtre redessinait l'index et le
 graphe, jamais l'inspecteur. Décocher `raw-source` retirait donc ses pages
 partout sauf là — et l'en-tête du panneau annonçait en plus la taille complète
 de la communauté pendant que la liste en dessous obéissait au filtre.
*/

const selection = graphUiSelectionScript();
const script = graphAppScript;

describe('le panneau de droite suit les filtres de type', () => {
  it('rejoue l’inspecteur au changement de filtre, avec l’index et le canevas', () => {
    // Viser le GESTIONNAIRE, pas la première mention de #filters : renderFilters
    // en contient une autre, et le test aurait mesuré le mauvais bout de code.
    const at = script.indexOf("querySelector('#filters').addEventListener('change'");
    expect(at).toBeGreaterThan(-1);
    const body = script.slice(at, script.indexOf('\n', at));
    expect(body).toContain('renderCommunityIndex()');
    expect(body).toContain('render()');
    expect(body).toContain('refreshInspector()');
  });

  it('sait rejouer les deux niveaux, document et communauté', () => {
    // Sans les deux branches, sélectionner un document puis filtrer laisserait
    // le panneau figé exactement comme avant le correctif.
    expect(selection).toContain('function refreshInspector()');
    expect(selection).toContain('if(selected)renderDocumentFocusWindow(selected)');
    expect(selection).toContain('else if(selectedCommunity)renderCommunityInspector(selectedCommunity)');
  });

  it('sépare le rendu du panneau de la sélection', () => {
    // Le rendu ne doit dépendre que de l'identifiant reçu : s'il touchait encore
    // `selected` ou `view`, le rejouer sur un filtre déplacerait la navigation.
    const start = selection.indexOf('function renderCommunityInspector');
    const end = selection.indexOf('function selectCommunity');
    const rendering = selection.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(rendering).not.toContain('selected=');
    expect(rendering).not.toContain('view=');
    expect(rendering).not.toContain('render()');
  });

  it('annonce le nombre affiché, pas la taille totale, quand un filtre masque', () => {
    expect(selection).toContain("shown.length+' of '+community.documentCount+' documents'");
    // La liste rendue est celle qui a été comptée : deux expressions distinctes
    // auraient recommencé à diverger.
    expect(selection).toContain('shown.slice(0,50)');
  });
});
