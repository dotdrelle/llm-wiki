export function graphUiSearchScript(): string {
  return String.raw`
function searchMatches(query=''){const q=query.trim().toLocaleLowerCase();return data.nodes.filter(n=>n.type!=='raw-source'&&(!q||(n.title+' '+n.id+' '+(n.group||'')+' '+(n.community?.communityLabel||'')).toLocaleLowerCase().includes(q))).slice(0,10)}
function renderSearchOptions(query=''){const results=document.querySelector('#graph-search-results'),matches=searchMatches(query);results.innerHTML=matches.map((n,i)=>'<button class="graph-search-item'+(i===0?' active':'')+'" data-search-id="'+esc(n.id)+'"><span>'+esc(n.title)+'</span><small>'+esc(n.id)+'</small></button>').join('');results.hidden=!query.trim()||matches.length===0}
function activateSearch(id){const input=document.querySelector('#search'),result=id?data.nodes.find(n=>n.id===id):searchMatches(input.value)[0];if(!result)return;input.value=result.title;document.querySelector('#graph-search-results').hidden=true;if(view==='community')openCommunityForDocument(result.id);selectDocument(result);render()}
`;
}
