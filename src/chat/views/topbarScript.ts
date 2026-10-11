/**
 * The chat top bar: the model badge (a .wikirc profile switcher when the
 * runtime is on) and one connector status pill. Extracted from chatHtml.ts.
 */
export const TOPBAR_SCRIPT = `
// The badge names the model, prefixed by the profile when it is not the
// default one. With the runtime on it opens the profile menu.
function syncModel() {
  const badge=$('model-badge');
  if(!badge) return;
  const model=$('model-name').value||'model';
  const profile=$('profile-picker')?.dataset.active||'';
  const switchable=!!window.__WIKI_CONFIG__?.runtime?.enabled;
  badge.textContent=(profile&&profile!=='default'?profile+' · ':'')+model+(switchable?' ▾':'');
  badge.title=switchable?'Active .wikirc profile'+(profile?' "'+profile+'"':'')+' — click to switch':'Model';
  badge.classList.toggle('switchable',switchable);
}

// Profile menu: the same switch as the config panel's picker (runtime
// /config/use, persisted for the ShellUI and serve), refused while a run is
// active. Profiles are re-read at each opening: one may have been added, or
// switched from the ShellUI.
async function toggleProfileMenu(event) {
  event?.stopPropagation();
  const menu=$('profile-menu'), badge=$('model-badge');
  if(!menu||!window.__WIKI_CONFIG__?.runtime?.enabled) return;
  if(!menu.hidden) { closeProfileMenu(); return; }
  menu.innerHTML='<div class="tb-profile-empty">Loading profiles…</div>';
  menu.hidden=false; badge?.setAttribute('aria-expanded','true');
  try {
    const res=await fetch('/api/config/profiles',{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||\`HTTP \${res.status}\`);
    const items=Array.isArray(data.items)?data.items:[];
    if(!items.length) { menu.innerHTML='<div class="tb-profile-empty">No .wikirc profile found.</div>'; return; }
    menu.innerHTML=items.map(item=>\`<button type="button" role="menuitemradio" aria-checked="\${item.name===data.active}" class="tb-profile-item\${item.name===data.active?' active':''}" data-profile="\${esc(item.name)}" title="\${esc(item.fileName||'')}"><span>\${item.name===data.active?'✓':''}</span>\${esc(item.name)}</button>\`).join('');
    menu.querySelectorAll('.tb-profile-item').forEach(btn=>btn.addEventListener('click',async()=>{
      const name=btn.dataset.profile;
      closeProfileMenu();
      if(name&&name!==data.active) {
        const select=$('profile-picker');
        if(select) select.value=name;
        await switchConfigProfile(name);
        syncModel();
      }
    }));
  } catch(err) {
    menu.innerHTML='<div class="tb-profile-empty">Profiles unavailable: '+esc(err?.message||String(err))+'</div>';
  }
}
function closeProfileMenu() {
  const menu=$('profile-menu');
  if(menu) menu.hidden=true;
  $('model-badge')?.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{ if(!e.target.closest?.('.tb-model-wrap')) closeProfileMenu(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeProfileMenu(); });

// One status pill instead of a chip per server: quiet while every connector
// answers, and naming the one that does not — a list of the healthy ones hid
// exactly the failure worth seeing. A click opens the Connectors view.
function renderTopPills() {
  const el=$('tb-mcps');
  if(!el) return;
  const ok=servers.filter(s=>s.enabled&&s.status==='ok');
  const failing=servers.filter(s=>s.status==='err');
  const state=failing.length?'warn':ok.length?'ok':'off';
  const label=failing.length
    ? (failing.length===1?\`\${failing[0].name} down\`:\`\${failing.length} connectors down\`)
    : ok.length?\`\${ok.length} connector\${ok.length>1?'s':''}\`:'No connector';
  el.className='tb-connectors '+state;
  el.innerHTML=\`<span class="tb-dot"></span>\${esc(label)}\`;
  el.title=[
    ...ok.map(s=>\`● \${s.name} — \${s.tools.length} tools\`),
    ...failing.map(s=>\`✕ \${s.name} — \${s.error||'not answering'}\`),
    'Click to open Connectors',
  ].join('\\n');
}
`;
