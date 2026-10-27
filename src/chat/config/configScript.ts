export const CONFIG_SCRIPT = `const SVG_EYE     = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>\`;
const SVG_EYE_OFF = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\`;

function safeConnectorUrl(raw) {
  try {
    const url=new URL(String(raw||''));
    const hasUrlSecrets=!!(url.username||url.password||url.search||url.hash);
    url.username=''; url.password=''; url.search=''; url.hash='';
    return {url:url.toString(),hasUrlSecrets};
  } catch { return {url:'',hasUrlSecrets:!!raw}; }
}

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

function applyServerConfig(config) {
  if(!config||typeof config!=='object') return;
  const llm=config.llm||config;
  window.__WIKI_CONFIG__={...(window.__WIKI_CONFIG__||{}),
    provider:llm.provider??window.__WIKI_CONFIG__?.provider,
    model:llm.model??window.__WIKI_CONFIG__?.model,
    temperature:llm.temperature??window.__WIKI_CONFIG__?.temperature,
    baseUrl:llm.baseUrl??window.__WIKI_CONFIG__?.baseUrl,
    hasApiKey:llm.hasApiKey??window.__WIKI_CONFIG__?.hasApiKey,
    language:config.language??window.__WIKI_CONFIG__?.language,
  };
  syncModel();
}

async function loadConfigProfiles() {
  if(!window.__WIKI_CONFIG__?.runtime?.enabled) {
    setActiveConfigProfile('', '');
    return;
  }
  try {
    const res=await fetch('/api/config/profiles',{cache:'no-store'});
    if(!res.ok) throw new Error('profiles unavailable');
    const data=await res.json();
    // The FILE identifies a profile; two files can both be named "default".
    const entries=profileEntries(data);
    if(!entries.length) {
      setActiveConfigProfile('', '');
      return;
    }
    const active=entries.find(entry=>entry.active)||entries[0];
    setActiveConfigProfile(active.name, active.fileName);
  } catch {
    setActiveConfigProfile('', '');
  }
}

async function switchConfigProfile(profile) {
  if(!profile) return;
  try {
    const res=await fetch('/api/config/use',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({profile}),
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false) throw new Error(data.error||data.message||\`HTTP \${res.status}\`);
    setActiveConfigProfile(data.active||profile, data.fileName||profile);
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
    notify(err?.message||String(err),'e');
  }
}

function setActiveConfigProfile(name,fileName) {
  window.__WIKI_ACTIVE_PROFILE__={name:name||'',fileName:fileName||''};
  syncModel();
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
    const projectedUrl=safeConnectorUrl(s.url);
    const hasUrlSecrets=!!(s.hasUrlSecrets||projectedUrl.hasUrlSecrets);
    // A token is kept here only while the card waits to be saved by the
    // runtime (bearerDraft); once saved, the page only knows that one exists.
    const draft=!inDefaults&&(s.needsSync||!s.persistedName)?(s.bearerDraft||''):'';
    return {id:s.id,name:s.name,url:projectedUrl.url,hasUrlSecrets,urlSecretOmitted:!!(s.urlSecretOmitted||(projectedUrl.hasUrlSecrets&&(!s.persistedName||s.needsSync))),bearerDraft:draft,hasBearer:!!s.hasBearer,enabled:s.enabled&&s.status==='ok',injected:s.injected,persistedName:s.persistedName||null,origin:s.origin||'ui',needsSync:!!s.needsSync,syncError:s.syncError||''};
  });
  localStorage.setItem(LS.USER_SERVERS, JSON.stringify(data));
}

async function restoreEnabledServers({connectorsFirst=false}={}) {
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
  if(connectorsFirst) {
    // The Agent / Connector cards need only this MCP endpoint. Restore it
    // before unrelated endpoints so a slow or offline wiki/agent server does
    // not keep Gmail and Tchap stuck on "Checking…" during page startup.
    const connector=toRestore.find(server=>['connectors','agent-connectors'].includes(String(server.name||'').toLowerCase()));
    if(connector) {
      await connectServer(connector.id,{silent:true});
      const remaining=toRestore.filter(server=>server!==connector);
      void (async()=>{
        for(const server of remaining) await connectServer(server.id,{silent:true});
      })();
      return;
    }
  }
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
  const wcoBrand = document.getElementById('wco-titlebar-brand');
  if (wcoBrand) wcoBrand.textContent = '⬡ ' + label;
}

function loadConfig() {
  // The LLM endpoint, key and model belong to the active .wikirc profile,
  // switched from the model badge. The sidebar no longer edits them, so an
  // override a former panel left in the browser is dropped, never replayed.
  try { localStorage.removeItem(storageKey('mcpchat_config')); } catch {}
  // The workspace file, never a browser copy: a copy kept in localStorage
  // outlived every edit of the file and, with the runtime on, reached no model.
  try { localStorage.removeItem(storageKey('mcpchat_system_prompt')); } catch {}
  $('system-prompt').value = window.__WIKI_CONFIG__ ? (window.__WIKI_CONFIG__.systemPromptFile ?? '') : (window.__WIKI_CONFIG__?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
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
        const urlProjection = safeConnectorUrl(override ? override.url : s.url);
        const url = urlProjection.url;
        if(urlProjection.hasUrlSecrets) dirty=true;
        const hasUrlSecrets = !!(override ? (override.hasUrlSecrets||urlProjection.hasUrlSecrets) : (s.hasUrlSecrets||urlProjection.hasUrlSecrets));
        // \`bearer\` is the pre-write-only field of older releases: a card
        // the runtime already saved drops it (the runtime holds the token);
        // an unsaved one keeps it as its draft until the save.
        const hasBearer = override ? !!override.hasBearer : !!(s.hasBearer || s.bearer);
        const bearerDraft = override || (s.persistedName && !s.needsSync) ? '' : (s.bearerDraft || s.bearer || '');
        if(s.bearer) dirty=true;
        const injected = override ? true : (s.injected === true);
        const origin=override?.origin||s.origin||'ui';
        // The timeout is read from the endpoint file, never from localStorage:
        // the Connectors panel no longer edits it, so a value left by an older
        // release must not keep applying invisibly.
        const persistedName=override?name:(s.persistedName||null);
        const urlSecretOmitted=!!(s.urlSecretOmitted||(urlProjection.hasUrlSecrets&&(!persistedName||s.needsSync)));
        servers.push({...s, bearer:undefined, name, url, hasUrlSecrets, urlSecretOmitted, hasBearer, bearerDraft, timeoutMs:override?(override.timeoutMs??null):null, injected, origin, persistedName, needsSync:override?false:!!s.needsSync, syncError:s.syncError||'', enabled:override ? true : !!s.enabled, sessionId:null, status:'off', tools:[]});
        if(s.id >= nextId) nextId = s.id + 1;
      }
      for (const s of defaults) {
        if(seen.has(s.name)) continue;
        dirty=true;
        const id=nextId++;
        servers.push({id, name:s.name, url:s.url, hasUrlSecrets:!!s.hasUrlSecrets, urlSecretOmitted:false, hasBearer:!!s.hasBearer, bearerDraft:'', timeoutMs:s.timeoutMs??null, injected:true, origin:s.origin||'global', persistedName:s.name, needsSync:false, syncError:'', enabled:true, status:'off', tools:[]});
      }
      renderCards();
      if(dirty) saveServers();
      return;
    }
  } catch {}
  // No saved state (or stale) — seed from server config
  for (const s of defaults) {
    const id=nextId++;
    servers.push({id, name:s.name, url:s.url, hasUrlSecrets:!!s.hasUrlSecrets, urlSecretOmitted:false, hasBearer:!!s.hasBearer, bearerDraft:'', timeoutMs:s.timeoutMs??null, injected:true, origin:s.origin||'global', persistedName:s.name, needsSync:false, syncError:'', sessionId:null, enabled:true, status:'off', tools:[]});
  }
  renderCards(); saveServers();
}
`;
