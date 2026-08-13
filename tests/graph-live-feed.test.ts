import { describe, expect, it } from 'vitest';
import { graphUiLiveScript } from '../src/graph/wiki/ui/core/liveScript.ts';
import { graphAppScript } from '../src/graph/wiki/ui/script.ts';
import { WIKI_PANEL_SCRIPT } from '../src/chat/views/wikiPanelScript.ts';

const live = graphUiLiveScript();

describe('réception des révisions du graphe', () => {
  /*
   Le remplacement du document est ce que ce chantier existe pour supprimer.
   Une révision se réconcilie en place, à travers render() → setScene, qui
   conserve caméra, cadrage et positions sauvegardées.
  */
  it('ne recharge ni ne remonte jamais', () => {
    for (const source of [live, graphAppScript, WIKI_PANEL_SCRIPT]) {
      expect(source).not.toContain('location.reload');
    }
    expect(live).toContain('function applyGraphRevision(next)');
    expect(live).toContain('renderFilters();renderSearchOptions();render()');
  });

  /*
   Le halo « nouveau » existait depuis longtemps mais rien ne l'alimentait :
   graphFreshNodes n'était jamais rempli. C'est ici que ça se produit, et il
   faut relever les identifiants AVANT de remplacer les données.
  */
  it('alimente le halo depuis la comparaison avant/après', () => {
    expect(live).toContain('const known=new Set((data&&data.nodes||[]).map(node=>node.id))');
    expect(live).toContain('if(!known.has(node.id))graphFreshNodes.set(node.id,performance.now())');
    // Les communautés aussi : une bulle inédite doit se signaler.
    expect(live).toContain('knownCommunities.has(item.id)');
    // L'ordre compte : la capture précède l'affectation de `data`.
    expect(live.indexOf('const known=new Set')).toBeLessThan(live.indexOf('data=next;'));
  });

  it('garde une seule récupération en vol et laisse gagner la dernière révision', () => {
    expect(live).toContain('let graphRevision=0,graphFetching=false,graphWanted=0');
    expect(live).toContain('if(!Number.isFinite(revision)||revision<=graphRevision)return');
    expect(live).toContain('if(graphFetching)return');
    expect(live).toContain('graphWanted=Math.max(graphWanted,revision)');
    expect(live).toContain("if(next.taxonomyRevision<target)throw new Error('graph snapshot behind announced revision')");
    expect(live).toContain('scheduleGraphRetry()');
    expect(live).toContain('Math.min(graphRetryDelay*2,10000)');
  });

  /*
   Une EventSource par iframe multiplierait les connexions et les tempêtes de
   reconnexion pour un seul et même flux. Le shell tient la connexion, le
   graphe embarqué écoute ; en autonome il ouvre la sienne. Jamais les deux.
  */
  it('choisit entre relais du parent et connexion directe', () => {
    expect(live).toContain('if(window.parent&&window.parent!==window)');
    expect(live).toContain("postMessage({type:'llmwiki:graph-subscribe'},location.origin)");
    expect(live).toContain("new EventSource('/api/graph/events')");
    // Le mode embarqué sort avant d'atteindre l'ouverture directe.
    const embedded = live.indexOf("postMessage({type:'llmwiki:graph-subscribe'}");
    const direct = live.indexOf("new EventSource('/api/graph/events')");
    expect(embedded).toBeLessThan(direct);
    expect(live.slice(embedded, direct)).toContain('return}');
  });

  it('vérifie l’origine des messages reçus dans l’iframe', () => {
    expect(live).toContain('if(event.origin!==location.origin)return');
  });

  it('ferme le flux avec le document plutôt que de le laisser filer', () => {
    expect(live).toContain("window.addEventListener('pagehide',()=>{stream.close();if(graphRetryTimer)clearTimeout(graphRetryTimer)})");
  });

  it('démarre le flux après le premier chargement, pas avant', () => {
    // On borne la lecture au corps de load() : `startGraphRevisionFeed` est
    // défini plus haut dans le script concaténé, et sa définition n'apprend
    // rien sur l'ordre d'appel.
    const load = graphAppScript.slice(
      graphAppScript.indexOf('async function load()'),
      graphAppScript.indexOf('function render()'),
    );

    expect(load).toContain('graphRevision=data.taxonomyRevision||0');
    expect(load).toContain('startGraphRevisionFeed()');
    // Le premier snapshot fixe la révision de départ : sans lui, la première
    // notification déclencherait une récupération redondante.
    expect(load.indexOf('graphRevision=data.taxonomyRevision'))
      .toBeLessThan(load.indexOf('startGraphRevisionFeed()'));
  });
});

describe('relais du shell', () => {
  it('n’ouvre qu’une connexion, à la demande', () => {
    expect(WIKI_PANEL_SCRIPT).toContain('let graphRevisionStream = null');
    expect(WIKI_PANEL_SCRIPT).toContain('if (graphRevisionStream || typeof EventSource !== \'function\') return');
    // Ouverture paresseuse : un shell dont le graphe n'est jamais affiché ne
    // surveille rien.
    expect(WIKI_PANEL_SCRIPT).toContain("data.type === 'llmwiki:graph-subscribe'");
    expect(WIKI_PANEL_SCRIPT).toContain('startGraphRevisionRelay();');
  });

  it('relaie vers les cadres susceptibles de porter un graphe', () => {
    expect(WIKI_PANEL_SCRIPT).toContain("['wiki-frame', 'wiki-side-frame']");
    expect(WIKI_PANEL_SCRIPT).toContain("{ type: 'llmwiki:graph-revision', revision }, location.origin");
  });

  it('ferme le flux avec le document', () => {
    expect(WIKI_PANEL_SCRIPT).toContain('graphRevisionStream?.close()');
  });
});
