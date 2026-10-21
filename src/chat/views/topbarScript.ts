/**
 * The model badge in the composer and the separate workspace-connector and
 * MCP status pills in the top bar. Extracted from chatHtml.ts.
 */
export const TOPBAR_SCRIPT = `
// The badge names the model only; the profile, its file and the provider sit
// in the tooltip. With the runtime on it opens the profile menu.
function syncModel() {
  const badge=$('model-badge');
  if(!badge) return;
  const model=window.__WIKI_CONFIG__?.model||'model';
  const activeProfile=window.__WIKI_ACTIVE_PROFILE__||{};
  const activeFile=activeProfile.fileName||'';
  const activeName=activeProfile.name||'';
  // A second "default" (.wikirc.yaml.default) is named by its file.
  const profile=activeName==='default'&&activeFile&&activeFile!=='.wikirc.yaml'?activeFile:activeName;
  const switchable=!!window.__WIKI_CONFIG__?.runtime?.enabled;
  const provider=window.__WIKI_CONFIG__?.provider||'';
  badge.textContent=model;
  badge.title=[
    'Model: '+model,
    profile?'Profile: '+profile+(activeFile&&activeFile!==profile?' ('+activeFile+')':''):'',
    provider?'Provider: '+provider:'',
    switchable?'Click to switch the .wikirc profile':'',
  ].filter(Boolean).join('\\n');
  badge.classList.toggle('switchable',switchable);
}

// Profile menu: the runtime /config/use route, persisted for the ShellUI and
// serve. Profiles are re-read at each opening: one may have been added, or
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
    const entries=profileEntries(data);
    if(!entries.length) { menu.innerHTML='<div class="tb-profile-empty">No .wikirc profile found.</div>'; return; }
    const active=entries.find(entry=>entry.active);
    if(active) setActiveConfigProfile(active.name,active.fileName);
    menu.innerHTML=entries.map(entry=>\`<button type="button" role="menuitemradio" aria-checked="\${entry.active}" class="tb-profile-item\${entry.active?' active':''}" data-file="\${esc(entry.fileName)}" title="\${esc(entry.fileName)}"><span>\${entry.active?'✓':''}</span>\${esc(entry.name)}\${entry.showFile?\`<em class="tb-profile-file">\${esc(entry.fileName)}</em>\`:''}</button>\`).join('');
    menu.querySelectorAll('.tb-profile-item').forEach(btn=>btn.addEventListener('click',async()=>{
      const fileName=btn.dataset.file;
      closeProfileMenu();
      if(fileName&&!btn.classList.contains('active')) {
        await switchConfigProfile(fileName);
        syncModel();
      }
    }));
  } catch(err) {
    menu.innerHTML='<div class="tb-profile-empty">Profiles unavailable: '+esc(err?.message||String(err))+'</div>';
  }
}
// The FILE identifies a profile: ".wikirc.yaml" and ".wikirc.yaml.default"
// both list as "default", and matching on the name checked both and switched
// to the first. Colliding names show their file.
function profileEntries(data) {
  const items=Array.isArray(data?.items)?data.items.filter(item=>item&&item.fileName):[];
  const counts={};
  items.forEach(item=>{ counts[item.name]=(counts[item.name]||0)+1; });
  const activeFile=data?.activeFileName||(items.find(item=>item.name===data?.active)||{}).fileName||'';
  return items.map(item=>({name:item.name,fileName:item.fileName,showFile:counts[item.name]>1,active:item.fileName===activeFile}));
}

function closeProfileMenu() {
  const menu=$('profile-menu');
  if(menu) menu.hidden=true;
  $('model-badge')?.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{ if(!e.target.closest?.('.tb-model-wrap')) closeProfileMenu(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeProfileMenu(); });

// The MCP pill counts ready MCP endpoints and switches to a failure count
// when any endpoint does not answer. The separate Connectors pill counts the
// workspace integrations (Gmail and Tchap). Both open the Connectors view.
function renderTopPills() {
  const el=$('tb-mcps');
  if(!el) return;
  const ok=servers.filter(s=>s.enabled&&s.status==='ok');
  const failing=servers.filter(s=>s.status==='err');
  const count=servers.length;
  const state=failing.length||servers.some(s=>!s.enabled)?'warn':ok.length===count&&count?'ok':'off';
  const label=count?\`\${count} MCP\${count>1?'s':''}\`:'No MCPs';
  el.className='tb-connectors '+state;
  el.innerHTML=\`<span class="tb-dot"></span>\${esc(label)}\`;
  el.title=[
    ...ok.map(s=>\`● \${s.name} — \${s.tools.length} tools\`),
    ...failing.map(s=>\`✕ \${s.name} — \${s.error||'not answering'}\`),
    ...servers.filter(s=>!s.enabled&&s.status!=='err').map(s=>\`○ \${s.name} — disabled\`),
    'Click to open Connectors',
  ].join('\\n');
}
`;
