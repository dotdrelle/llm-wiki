export function graphUiSearchScript(): string {
  return String.raw`
function searchMatches(query=''){const q=query.trim().toLocaleLowerCase();return data.nodes.filter(n=>n.type!=='raw-source'&&(!q||(n.title+' '+n.id+' '+(n.group||'')+' '+(n.community?.communityLabel||'')+' '+(n.subject||'')+' '+(n.okfType||'')+' '+((n.tags||[]).join(' '))).toLocaleLowerCase().includes(q))).slice(0,10)}
/*
The dropdown offers TWO things: keep the global filtered view, or jump to one
document. Without the first entry, the only way to dismiss the list was to pick
a leaf — which left the filtered graph, exactly what the reader was looking at.
*/
function renderSearchOptions(query=''){
  const results=document.querySelector('#graph-search-results');
  const q=query.trim();
  const matches=searchMatches(query);
  if(!q||!matches.length){results.innerHTML='';results.hidden=true;return}
  const filterItem='<button class="graph-search-item graph-search-filter" type="button" data-search-filter="1"><span>Filter the graph for \u201c'+esc(q)+'\u201d</span><small>'+matches.length+' result(s) \u00b7 stay in the filtered view</small></button>';
  results.innerHTML=filterItem+matches.map(n=>'<button class="graph-search-item" type="button" data-search-id="'+esc(n.id)+'"><span>'+esc(n.title)+'</span><small>'+esc(n.id)+'</small></button>').join('');
  results.hidden=false;
}
function closeSearchOptions(){const results=document.querySelector('#graph-search-results');if(results)results.hidden=true}
function activateSearch(id){const input=document.querySelector('#search'),result=id?data.nodes.find(n=>n.id===id):searchMatches(input.value)[0];if(!result)return;input.value=result.title;closeSearchOptions();selectedCommunity=data.communities.find(c=>c.nodeIds.includes(result.id))?.id||null;view='focus';selectDocument(result);render()}
`;
}
