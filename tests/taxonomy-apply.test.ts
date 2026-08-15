import { describe, expect, it } from 'vitest';
import { assignGraphCommunities } from '../src/graph/wiki/communityProjection.ts';
import { communityRedirects, registryLookup } from '../src/graph/wiki/taxonomy/lookup.ts';
import { REGISTRY_SCHEMA_VERSION, type TaxonomyRegistry } from '../src/graph/wiki/taxonomy/schema.ts';
import { graphUiLiveScript } from '../src/graph/wiki/ui/core/liveScript.ts';
import { canvasExplorerScript } from '../src/graph/wiki/ui/canvas/canvasExplorerScript.ts';
import type { WikiGraphEdge, WikiGraphNode } from '../src/graph/wiki/projection.ts';
import { withCoverage } from './support/registryCoverage.ts';

function node(id: string, group?: string): WikiGraphNode {
  return {
    id,
    title: id,
    type: 'wiki',
    href: `/${id}`,
    preview: '',
    raw: '',
    html: '',
    group,
    community: { communityId: 'ungrouped', communityLabel: 'Ungrouped', assignment: 'fallback' },
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

const registry: TaxonomyRegistry = withCoverage({
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  revision: 7,
  corpus: 'sha1:abc',
  languages: ['fr', 'en'],
  communities: [
    { id: 'cmty_sol', prefLabel: { fr: 'Solution', en: 'Solution' }, firstSeenRevision: 1 },
    {
      id: 'cmty_saas',
      prefLabel: { fr: 'Saas' },
      firstSeenRevision: 1,
      deprecated: true,
      replacedBy: 'cmty_sol',
    },
  ],
  assignments: {
    'wiki/concepts/a.md': { primaryCommunity: 'cmty_sol' },
    // Affectation qui pointe encore le concept absorbé : elle doit rendre la
    // communauté ACTIVE, pas une bulle disparue.
    'wiki/concepts/b.md': { primaryCommunity: 'cmty_saas' },
  },
});

const assign = (nodes: WikiGraphNode[], edges: WikiGraphEdge[] = [], language = 'fr') =>
  assignGraphCommunities(nodes, edges, new Map(), 'Ungrouped', {
    registry: registryLookup(registry, language),
  });

describe('hiérarchie d’affectation', () => {
  /*
   L'ordre est : community: explicite > registre > graine (group:, dossier) >
   héritage > repli. Chaque cran doit être observable, sinon un jour l'un
   d'eux passera devant l'autre sans que rien n'échoue.
  */
  it('laisse une décision d’auteur devant le registre', () => {
    const assigned = assignGraphCommunities(
      [node('wiki/concepts/a.md')],
      [],
      new Map([['wiki/concepts/a.md', { label: 'Décidé' }]]),
      'Ungrouped',
      { registry: registryLookup(registry, 'fr') },
    );

    expect(assigned[0]!.community).toMatchObject({
      communityLabel: 'Décidé',
      assignment: 'explicit',
    });
  });

  it('place le registre devant une graine', () => {
    // La page porte `group: Autre`, mais le registre l'a rangée ailleurs.
    const assigned = assign([node('wiki/concepts/a.md', 'Autre')]);

    expect(assigned[0]!.community).toMatchObject({
      communityId: 'cmty_sol',
      communityLabel: 'Solution',
      assignment: 'synthesized',
    });
  });

  /*
   `group:` était promu en communauté explicite par `graphCommunityMetadata`
   (`community = rawCommunity ?? group`), ce qui le rendait intouchable par les
   passes de réparation. C'est un indice d'ingestion, pas une décision.
  */
  it('traite group: comme une graine réparable, pas comme une décision', () => {
    const assigned = assignGraphCommunities([node('wiki/autre/page.md', 'Réseau')], [], new Map());

    expect(assigned[0]!.community).toMatchObject({
      communityLabel: 'Réseau',
      assignment: 'seed',
    });
  });

  it('traite un dossier de concepts comme une graine', () => {
    const assigned = assignGraphCommunities([node('wiki/concepts/securite/a.md')], [], new Map());

    expect(assigned[0]!.community.assignment).toBe('seed');
  });

  it('résout une affectation pointant un concept absorbé', () => {
    const assigned = assign([node('wiki/concepts/b.md')]);

    // La page reste visible, dans la communauté qui a absorbé la sienne.
    expect(assigned[0]!.community).toMatchObject({
      communityId: 'cmty_sol',
      assignment: 'synthesized',
    });
  });

  it('rend le libellé dans la langue demandée', () => {
    expect(assign([node('wiki/concepts/a.md')], [], 'en')[0]!.community.communityLabel)
      .toBe('Solution');
  });

  /*
   Une graine est RÉPARABLE, et c'est tout l'intérêt de la distinguer d'une
   décision : une page isolée que `group:` rangeait seule dans son domaine est
   maintenant dissoute par les passes de cohésion, là où l'ancien `?? group`
   la protégeait en la faisant passer pour un choix d'auteur.

   Ce que le registre couvre, en revanche, ne bouge pas.
  */
  it('protège le registre des passes de réparation, mais pas une graine', () => {
    const assigned = assign([node('wiki/concepts/a.md'), node('wiki/autre/isolee.md', 'Réseau')]);

    expect(assigned[0]!.community).toMatchObject({
      communityId: 'cmty_sol',
      assignment: 'synthesized',
    });
    // La page isolée n'a aucune relation : « Réseau » n'était pas un domaine,
    // c'était une étiquette. Elle repart au repli plutôt que de peupler la
    // carte d'un halo « 1 page ».
    expect(assigned[1]!.community.assignment).not.toBe('seed');
    expect(assigned[1]!.community.communityLabel).toBe('Ungrouped');
  });
});

describe('redirections de fusion', () => {
  it('expose l’absorbé vers l’actif', () => {
    expect(communityRedirects(registry)).toEqual({ cmty_saas: 'cmty_sol', solution: 'cmty_sol' });
  });

  it('migre le slug historique même quand rien n’a fusionné', () => {
    expect(communityRedirects({ ...registry, communities: [registry.communities[0]!] })).toEqual({
      solution: 'cmty_sol',
    });
  });
});

describe('continuité côté client', () => {
  const live = graphUiLiveScript();
  const canvas = canvasExplorerScript();

  it('reporte la position manuelle de l’absorbé sur la cible', () => {
    expect(canvas).toContain('function migrateCanvasExplorerPositions(redirects)');
    // Une position choisie explicitement pour la cible prime sur une héritée.
    expect(canvas).toContain('if(!readCanvasExplorerPosition(to))');
    expect(canvas).toContain('localStorage.removeItem(key)');
  });

  it('déplace la sélection sur la cible plutôt que de la perdre', () => {
    expect(live).toContain('function redirectGraphSelection(redirects)');
    expect(live).toContain('if(target)selectedCommunity=target');
    // Les deux migrations partent de la même table, appliquée à la révision.
    expect(live).toContain('migrateCanvasExplorerPositions(next.communityRedirects)');
    expect(live).toContain('redirectGraphSelection(next.communityRedirects)');
  });
});
