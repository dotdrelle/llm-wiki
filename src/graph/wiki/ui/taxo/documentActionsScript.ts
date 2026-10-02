/**
 * The document actions the context card offers — "Open page" (in-frame
 * preview) and "Add to Donna" — kept from the former graph unchanged.
 */
export function documentActionsScript(): string {
  return String.raw`
/*
 The Donna action carries Donna's mark, not a download arrow: a downward arrow
 onto a line is the universal "save to disk" icon.
*/
function graphIcon(name){return name==='preview'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>':name==='hammer'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9Z"/></svg>'}
/*
 "Send to Donna" only claims success once the shell grants it.

 The button used to turn green on the spot, before the message had been read:
 a path the shell refuses — or a graph opened outside the shell, where there is
 no parent to ask — looked exactly like a success. The confirmation now waits
 for llmwiki:addContext:result, and a standalone graph says plainly that it has
 nobody to send to rather than pretending.
*/
const graphPendingDonna=new Map();
function sendDocumentToDonna(id,button){
  const path='/'+id;
  if(!window.parent||window.parent===window){
    if(button){button.title='Open the graph inside the app to send documents to Donna'}
    return}
  if(button)graphPendingDonna.set(path,button);
  window.parent.postMessage({type:'llmwiki:addContext',path},window.location.origin)}
window.addEventListener('message',event=>{
  if(event.origin!==window.location.origin)return;
  const data=event.data;
  if(!data||data.type!=='llmwiki:addContext:result')return;
  const button=graphPendingDonna.get(data.path);
  if(!button)return;
  graphPendingDonna.delete(data.path);
  if(data.ok){button.classList.add('done');button.title='Added to Donna'}
  else{button.title='This document cannot be added to Donna'}});
async function previewGraphDocument(id){
  const overlay=document.querySelector('#document-preview-overlay'),content=document.querySelector('#document-preview-content'),heading=document.querySelector('#document-preview-title');
  overlay.hidden=false;heading.textContent='Document preview';content.innerHTML='<div class="loading" style="position:static;padding:2rem">Loading…</div>';
  try{const documentData=await json('/api/graph/document?id='+encodeURIComponent(id));heading.textContent=graphLeafDisplay(documentData.title);content.innerHTML=documentData.html}
  catch(error){content.innerHTML='<p>'+esc(error.message)+'</p>'}
}
function graphLeafDisplay(label){const text=String(label??'');return text?text.charAt(0).toUpperCase()+text.slice(1):text}
// The context card's head counts a node's neighbours: for a fiche, the
// concepts it tags; for a concept, its fiches.
function documentRelationCount(id){return bip.get(id)?.size||0}
function graphRelationsLabel(count){const value=count||0;return value===1?'':value+' relation'+(value===1?'':'s')}
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview-doc]');if(preview){event.stopImmediatePropagation();previewGraphDocument(preview.dataset.previewDoc);return}
  const send=event.target.closest('[data-send-doc]');if(send){event.stopImmediatePropagation();sendDocumentToDonna(send.dataset.sendDoc,send);return}
});
document.querySelector('#close-document-preview').addEventListener('click',()=>{document.querySelector('#document-preview-overlay').hidden=true;document.querySelector('#document-preview-content').innerHTML=''});
`;
}
