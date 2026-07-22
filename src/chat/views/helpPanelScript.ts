export const HELP_PANEL_SCRIPT = `/* ── Help panel ───────────────────────────────────────────────────── */
function toggleHelpPanel() {
  const panel=$('help-panel');
  if(!panel) return;
  const wasClosed=panel.classList.contains('closed');
  if(wasClosed) $('activity-panel')?.classList.add('closed');
  panel.classList.toggle('closed');
  updateActivityBadge();
  if(wasClosed) showHelpToc();
}
async function fetchHelpJson(url, errorMsg) {
  const body=$('help-body');
  if(!body) return null;
  body.innerHTML='<div class="help-loading">Loading…</div>';
  try {
    const r=await fetch(url);
    if(!r.ok) throw new Error('http '+r.status);
    return await r.json();
  } catch(e) {
    body.innerHTML='<div class="help-loading">'+errorMsg+'</div>';
    return null;
  }
}
async function showHelpToc() {
  const back=$('help-back');
  if(back) back.hidden=true;
  const data=await fetchHelpJson('/api/help', 'Unable to load help.');
  if(!data) return;
  const body=$('help-body');
  if(!body) return;
  const chapters=(data&&data.chapters)||[];
  if(!chapters.length){ body.innerHTML='<div class="help-loading">No documentation available.</div>'; return; }
  body.innerHTML=chapters.map(c=>'<button class="help-toc-item" type="button" data-help-id="'+esc(c.id)+'">'+esc(c.title||c.id)+'</button>').join('');
  if(!body.dataset.helpBound){ body.addEventListener('click',e=>{ const b=e.target.closest('.help-toc-item'); if(b&&b.dataset.helpId) openHelpChapter(b.dataset.helpId); }); body.dataset.helpBound='1'; }
}
async function openHelpChapter(id) {
  const data=await fetchHelpJson('/api/help/'+encodeURIComponent(id), 'Unable to load chapter.');
  if(!data) return;
  const body=$('help-body'); const back=$('help-back');
  const md=(data&&data.markdown)||'';
  if(body) body.innerHTML='<div class="help-article">'+renderMd(md)+'</div>';
  if(back) back.hidden=false;
  if(body) body.scrollTop=0;
}
/* ── end Help panel ───────────────────────────────────────────────── */`;
