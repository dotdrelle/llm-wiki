export function graphUiHelpersScript(): string {
  return String.raw`
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(await r.text());return r.json()}
function nodePositionKey(id){return 'llm-wiki:graph:node:'+encodeURIComponent(data?.workspace||'wiki')+':'+id}
/*
 Resolve a taxonomy identifier, leaf OR domain.

 "data.communities" only contains leaves: the registry ranges documents under
 them, never under a domain. But since the map folds up, everything selectable
 on screen — bubble, index row, breadcrumb — can carry a domain identifier.
 Every place that did "communities.find(id)" therefore found "nothing" and
 treated it as "empty set", which is the opposite of the truth: a domain has
 more members than a leaf, not fewer.

 The symptom was not the same depending on the caller — empty canvas on one
 side, entirely hidden index on the other — but the fault is a single one, and
 that is why it is fixed here rather than in each of them.
*/
function graphCommunityChildren(id){
  const parents=data?.communityParents||{};
  return (data?.communities||[]).filter(item=>parents[item.id]===id)}
function graphIsDomain(id){return (data?.domains||[]).some(item=>item.id===id)}
/**
 * The documents carried by an identifier: its own if it is a leaf, the union
 * of its children's if it is a domain. Empty if the identifier does not belong
 * to the taxonomy — a domain with no child stays empty, and that is correct.
 */
function graphCommunityMembers(id){
  if(!id||!data)return[];
  const leaf=data.communities.find(item=>item.id===id);
  if(leaf)return leaf.nodeIds;
  return graphCommunityChildren(id).flatMap(item=>item.nodeIds)}
/*
 A counter does not restate what the drawing already shows.

 "1 relation" under a bubble that visibly has one teaches nothing and occupies
 the line where one reads the document type. The counter only has value from
 the moment the eye can no longer count on its own — or when it is zero, which
 is not visible at all since nothing is drawn.
*/
function graphRelationsLabel(count){
  const value=count||0;
  if(value===1)return'';
  return value+' relation'+(value===1?'':'s')}
/*
 Two levels, two typographic treatments.

 A domain is a heading: capitals, as on the map. A leaf is a named subject —
 often a proper noun that the registry stores in lowercase because the model
 writes in lowercase. The initial capital restores its noun status without
 altering the registry, which remains the source.
*/
function graphDomainDisplay(label){return String(label??'').toUpperCase()}
function graphLeafDisplay(label){
  const text=String(label??'');
  return text ? text.charAt(0).toUpperCase()+text.slice(1) : text}
/** The displayable label of a leaf or a domain. */
function graphCommunityLabel(id){
  const leaf=(data?.communities||[]).find(item=>item.id===id);
  if(leaf)return leaf.label;
  return (data?.domains||[]).find(item=>item.id===id)?.label||id}
/*
 The type filters bear on what is LISTED, exactly as on what is DRAWN.

 The left index and the right panel listed each community's nodeIds whole, so
 a workspace with templates, build-context and raw sources listed every
 Markdown file while the corresponding checkboxes stayed unticked. Both lists
 now read the same single predicate as the graph: an enabled type set.
*/
function graphNodeTypeById(){return new Map(data.nodes.map(node=>[node.id,node.type]))}
function enabledTypes(){return new Set([...document.querySelectorAll('[data-type]:checked')].map(input=>input.dataset.type))}
`;
}
