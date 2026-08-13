export function graphUiHelpersScript(): string {
  return String.raw`
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(await r.text());return r.json()}
function nodePositionKey(id){return 'llm-wiki:graph:node:'+encodeURIComponent(data?.workspace||'wiki')+':'+id}
/*
 Résoudre un identifiant de la taxonomie, feuille OU domaine.

 « data.communities » ne contient que des feuilles : le registre range les
 documents sous elles, jamais sous un domaine. Or depuis que la carte se
 replie, tout ce qui se sélectionne à l'écran — bulle, ligne de l'index,
 fil d'Ariane — peut porter un identifiant de domaine. Chaque endroit qui
 faisait « communities.find(id) » trouvait donc « rien » et le traitait comme
 « ensemble vide », ce qui est le contraire de la vérité : un domaine a plus
 de membres qu'une feuille, pas moins.

 Le symptôme n'était pas le même selon l'appelant — canevas vide d'un côté,
 index entièrement masqué de l'autre — mais la faute est unique, et c'est
 pourquoi elle se corrige ici plutôt que chez chacun d'eux.
*/
function graphCommunityChildren(id){
  const parents=data?.communityParents||{};
  return (data?.communities||[]).filter(item=>parents[item.id]===id)}
function graphIsDomain(id){return (data?.domains||[]).some(item=>item.id===id)}
/**
 * Les documents portés par un identifiant : les siens s'il est une feuille,
 * l'union de ceux de ses filles s'il est un domaine. Vide si l'identifiant
 * n'appartient pas à la taxonomie — un domaine sans fille reste vide, et c'est
 * exact.
 */
function graphCommunityMembers(id){
  if(!id||!data)return[];
  const leaf=data.communities.find(item=>item.id===id);
  if(leaf)return leaf.nodeIds;
  return graphCommunityChildren(id).flatMap(item=>item.nodeIds)}
/*
 Un compteur ne redit pas ce que le dessin montre déjà.

 « 1 relation » sous une bulle qui en a visiblement une n'apprend rien et
 occupe la ligne où l'on lit le type du document. Le compteur n'a de valeur
 qu'à partir du moment où l'œil ne peut plus compter seul — ou quand il vaut
 zéro, qui ne se voit pas du tout puisque rien n'est dessiné.
*/
function graphRelationsLabel(count){
  const value=count||0;
  if(value===1)return'';
  return value+' relation'+(value===1?'':'s')}
/*
 Deux niveaux, deux traitements typographiques.

 Un domaine est une rubrique : capitales, comme sur la carte. Une feuille est un
 sujet nommé — souvent un nom propre que le registre stocke en minuscules parce
 que le modèle écrit en minuscules. La capitale initiale lui rend son statut de
 nom sans altérer le registre, qui reste la source.
*/
function graphDomainDisplay(label){return String(label??'').toUpperCase()}
function graphLeafDisplay(label){
  const text=String(label??'');
  return text ? text.charAt(0).toUpperCase()+text.slice(1) : text}
/** Le libellé affichable d'une feuille ou d'un domaine. */
function graphCommunityLabel(id){
  const leaf=(data?.communities||[]).find(item=>item.id===id);
  if(leaf)return leaf.label;
  return (data?.domains||[]).find(item=>item.id===id)?.label||id}
`;
}
