export const CONFIG_SCRIPT = `const SVG_EYE     = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>\`;
const SVG_EYE_OFF = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\`;

function toggleReveal(inputOrId, btn) {
  const inp = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
  if (isHidden) {
    clearTimeout(inp._hideTimer);
    inp._hideTimer = setTimeout(() => { inp.type='password'; btn.innerHTML=SVG_EYE; }, 8000);
  }
}

function flashSaved(id) {
  const el=$(id); if(!el) return;
  el.classList.add('show');
}

function saveConfig() {
  const cfg = {
    baseUrl: $('base-url').value,
    apiKey:  $('api-key').value,
    model:   $('model-name').value,
  };
  localStorage.setItem(storageKey('mcpchat_config'), JSON.stringify(cfg));
  fetch('/api/llm-config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    baseUrl:cfg.baseUrl,
    apiKey:cfg.apiKey,
    model:cfg.model,
  })}).catch(()=>{});
  if (cfg.apiKey) flashSaved('llm-saved');
}

/*
 Reset — revenir à la config du profil actif, connexions comprises.

 Reset ne faisait que réécrire les champs depuis GET /api/llm-config. Sur un
 workspace dont l'endpoint était injoignable, l'écran redevenait donc identique
 à celui d'un workspace sain pendant que tout continuait d'échouer, et les
 connecteurs MCP restaient tels quels. Le seul contournement connu était de
 créer un second profil .wikirc et de basculer dessus — ce qui marchait parce
 que la bascule, elle, passe par le chemin autoritaire côté serveur.

 Reset emprunte maintenant ce même chemin quand il existe, puis dit si
 l'endpoint répond.
*/
async function resetYamlConfig() {
  const select=$('profile-picker');
  const activeProfile=select?.dataset.active||select?.value||null;
  if(activeProfile&&window.__WIKI_CONFIG__?.runtime?.enabled) {
    // Réappliquer le profil actif : le serveur relit le .wikirc, et
    // switchConfigProfile reconnecte les MCP.
    await switchConfigProfile(activeProfile);
    await probeLlmEndpoint();
    return;
  }
  // Pas de runtime : le profil ne se rejoue pas côté serveur, on retombe sur
  // la relecture des champs — mais on reconnecte et on sonde quand même.
  const wc = window.__WIKI_CONFIG__;
  let cfg = wc;
  try {
    const res=await fetch('/api/llm-config',{cache:'no-store'});
    if(res.ok) cfg=await res.json();
  } catch {}
  localStorage.removeItem(storageKey('mcpchat_config'));
  if(cfg?.baseUrl) $('base-url').value=cfg.baseUrl;
  if(cfg?.apiKey!==undefined) $('api-key').value=cfg.apiKey||'';
  if(cfg?.model) $('model-name').value=cfg.model;
  syncModel();
  flashSaved('llm-saved');
  await restoreEnabledServers();
  await probeLlmEndpoint();
}

/** Dit si l'endpoint LLM configuré répond. Silencieux uniquement en cas de succès net. */
async function probeLlmEndpoint() {
  try {
    const res=await fetch('/api/llm/probe',{method:'POST'});
    const data=await res.json().catch(()=>({}));
    if(data?.ok===false) return notify(data.message||'LLM endpoint unreachable','e');
    if(data?.warning) return notify(data.warning,'e');
    notify('LLM endpoint reachable ('+(data?.models??0)+' models)');
  } catch(err) {
    notify('LLM probe failed: '+(err?.message||String(err)),'e');
  }
}

function applyServerConfig(config) {
  if(!config||typeof config!=='object') return;
  const llm=config.llm||config;
  window.__WIKI_CONFIG__={...(window.__WIKI_CONFIG__||{}),
    provider:llm.provider??window.__WIKI_CONFIG__?.provider,
    model:llm.model??window.__WIKI_CONFIG__?.model,
    temperature:llm.temperature??window.__WIKI_CONFIG__?.temperature,
    baseUrl:llm.baseUrl??window.__WIKI_CONFIG__?.baseUrl,
    apiKey:llm.apiKey??window.__WIKI_CONFIG__?.apiKey,
    language:config.language??window.__WIKI_CONFIG__?.language,
  };
  if(llm.baseUrl) $('base-url').value=llm.baseUrl;
  if(llm.apiKey!==undefined) $('api-key').value=llm.apiKey||'';
  if(llm.model) $('model-name').value=llm.model;
  syncModel();
}

async function loadConfigProfiles() {
  const select=$('profile-picker');
  if(!select||!window.__WIKI_CONFIG__?.runtime?.enabled) return;
  try {
    const res=await fetch('/api/config/profiles',{cache:'no-store'});
    if(!res.ok) throw new Error('profiles unavailable');
    const data=await res.json();
    // Show only the profile name — the backing .wikirc file is an
    // implementation detail, kept as a hover title instead of cluttering the option label.
    const profiles=Array.isArray(data.items)&&data.items.length
      ? data.items.map(item=>({name:item.name,fileName:item.fileName||''}))
      : (Array.isArray(data.profiles)?data.profiles.map(name=>({name,fileName:''})):[]);
    if(!profiles.length) return;
    select.innerHTML=profiles.map(profile=>\`<option value="\${esc(profile.name)}"\${profile.fileName?\` title="\${esc(profile.fileName)}"\`:''}>\${esc(profile.name)}</option>\`).join('');
    select.value=data.active||profiles[0].name;
    select.dataset.active=select.value;
    select.disabled=false;
    select.classList.add('visible');
  } catch {
    select.disabled=true;
    select.classList.remove('visible');
  }
}

async function switchConfigProfile(profile) {
  const select=$('profile-picker');
  if(!profile||!select) return;
  const previous=select.dataset.active||select.value;
  select.disabled=true;
  try {
    const res=await fetch('/api/config/use',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({profile}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false) throw new Error(data.error||data.message||\`HTTP \${res.status}\`);
    select.dataset.active=data.active||profile;
    select.value=data.active||profile;
    // A profile switch is authoritative — drop any leftover local override so
    // it can't resurface and silently diverge from the newly active profile.
    localStorage.removeItem(storageKey('mcpchat_config'));
    applyServerConfig(data.config);
    servers.forEach(server=>{ server.sessionId=null; server.status=server.enabled?'off':server.status; server.tools=[]; });
    servers=[];
    nextId=1;
    loadServers();
    renderTopPills();
    // loadServers() rebuilds the cards with status 'off' and no session: it
    // DESCRIBES the connectors, it does not connect them. Without this line a
    // profile switch left every MCP server disconnected and toolless — the
    // pills said "llm-wiki (15)" from the previous handshake while /chat had
    // nothing to call, and the only way back was reloading the page.
    await restoreEnabledServers();
    fetchRuntimeState().catch(()=>{});
    notify('Config profile: '+(data.active||profile));
  } catch(err) {
    select.value=previous;
    notify(err?.message||String(err),'e');
  } finally {
    select.disabled=false;
  }
}

// ── LocalStorage (user-added servers only) ──────────────────────────────────

function storageKey(key) {
  const scope = window.__WIKI_CONFIG__?.storageScope;
  return scope ? \`\${key}:\${scope}\` : key;
}

const LS = {USER_SERVERS: storageKey('mcpchat_user_servers')};

function saveServers() {
  const defaults = window.__WIKI_CONFIG__?.mcpServers || [];
  const data = servers.map(s => {
    const inDefaults = defaults.some(d => d.name === s.name);
    return {id:s.id,name:s.name,url:s.url,bearer:inDefaults?'':(s.bearer||''),enabled:s.enabled&&s.status==='ok',injected:s.injected,persistedName:s.persistedName||null,origin:s.origin||'ui',needsSync:!!s.needsSync,syncError:s.syncError||''};
  });
  localStorage.setItem(LS.USER_SERVERS, JSON.stringify(data));
}

async function restoreEnabledServers() {
  // Server-injected connectors are enabled optimistically, then verified by
  // the MCP initialize + tools/list handshake. Failed probes are silent here
  // and leave the connector in its explicit error/disabled state.
  const toRestore=servers.filter(s=>s.enabled);
  if(!toRestore.length) {
    renderCards();
    renderTopPills();
    return;
  }
  renderCards();
  for(const server of toRestore) {
    await connectServer(server.id,{silent:true});
  }
}

function applyWorkspaceTitle() {
  const wsName = window.__WIKI_CONFIG__?.workspaceName;
  if (!wsName) return;
  const label = String(wsName).toUpperCase();
  document.title = label;
  const navTitle = document.querySelector('.app-nav-title');
  if (navTitle) navTitle.textContent = label;
  const logoText = document.querySelector('.sb-logo-text');
  if (logoText) logoText.textContent = label;
}

function loadConfig() {
  const wc = window.__WIKI_CONFIG__;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey('mcpchat_config'))||'{}');
  } catch {}
  if (wc) {
    // Proxy mode: the active .wikirc profile (managed server-side by
    // wiki-manager runtime) is authoritative. A stale localStorage value here
    // used to silently win over it on every reload — and since
    // buildProxyLLMHeaders() sends an override header whenever the displayed
    // field differs from window.__WIKI_CONFIG__, that stale value would then
    // hijack the actual outbound LLM request regardless of which profile was
    // selected. Do not read from localStorage in this mode.
    if (wc.model) $('model-name').value = wc.model;
    if (wc.baseUrl) $('base-url').value = wc.baseUrl;
    if (wc.apiKey)  { $('api-key').value = wc.apiKey; flashSaved('llm-saved'); }
  } else {
    // CLI mode: no server-managed profile exists, so localStorage is the
    // only source of truth for these fields.
    if (saved.baseUrl) $('base-url').value = saved.baseUrl;
    if (saved.apiKey)  { $('api-key').value = saved.apiKey; flashSaved('llm-saved'); }
    if (saved.model)   $('model-name').value = saved.model;
  }
  $('system-prompt').value = localStorage.getItem(storageKey('mcpchat_system_prompt')) ?? window.__WIKI_CONFIG__?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  syncModel();
}

function loadServers() {
  const defaults = window.__WIKI_CONFIG__?.mcpServers || [];
  try {
    const saved = JSON.parse(localStorage.getItem(LS.USER_SERVERS)||'[]');
    // Discard stale data that used old proxy-path URLs (/api/mcp/*)
    const isStale = saved.some(s => typeof s.url === 'string' && s.url.startsWith('/api/mcp'));
    if (saved.length && !isStale) {
      const seen=new Set();
      let dirty=false;
      for (const s of saved) {
        // In proxy mode, always use the server-injected URL/bearer for known servers
        // to avoid stale localhost URLs looping back to the serve container
        const sName=String(s?.name||'');
        const override = defaults.find(d => d.name === sName)
          || (sName.startsWith('agent-') ? defaults.find(d => d.name === sName.slice('agent-'.length)) : null);
        const name = override ? override.name : s.name;
        if(seen.has(name)) { dirty=true; continue; }
        seen.add(name);
        if(override) dirty=true;
        const url = override ? override.url : s.url;
        const bearer = override ? (override.bearer || s.bearer || '') : (s.bearer || '');
        const injected = override ? true : (s.injected === true);
        const origin=override?.origin||s.origin||'ui';
        servers.push({...s, name, url, bearer, injected, origin, persistedName:override?name:(s.persistedName||null), needsSync:override?false:!!s.needsSync, syncError:s.syncError||'', enabled:override ? true : !!s.enabled, sessionId:null, status:'off', tools:[]});
        if(s.id >= nextId) nextId = s.id + 1;
      }
      for (const s of defaults) {
        if(seen.has(s.name)) continue;
        dirty=true;
        const id=nextId++;
        servers.push({id, name:s.name, url:s.url, bearer:s.bearer||'', injected:true, origin:s.origin||'global', persistedName:s.name, needsSync:false, syncError:'', enabled:true, status:'off', tools:[]});
      }
      renderCards();
      if(dirty) saveServers();
      return;
    }
  } catch {}
  // No saved state (or stale) — seed from server config
  for (const s of defaults) {
    const id=nextId++;
    servers.push({id, name:s.name, url:s.url, bearer:s.bearer||'', injected:true, origin:s.origin||'global', persistedName:s.name, needsSync:false, syncError:'', sessionId:null, enabled:true, status:'off', tools:[]});
  }
  renderCards(); saveServers();
}`;
