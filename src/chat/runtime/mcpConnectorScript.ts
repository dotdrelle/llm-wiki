export const MCP_CONNECTOR_SCRIPT = `// ── MCP connector controls over Streamable HTTP ────────────────────────────

async function readSSE(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result = null;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    const lines = buf.split('\\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const d = line.slice(6).trim();
        if (d && d !== '[DONE]') { try { result = JSON.parse(d); } catch {} }
      }
    }
  }
  return result;
}

function mcpProxyUrl(server) {
  return \`/api/mcp?url=\${encodeURIComponent(server.url)}\`;
}

async function mcpRPC(server, method, params) {
  const body = {jsonrpc: '2.0', id: Date.now(), method};
  if (params !== undefined) body.params = params;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (server.bearer?.trim()) headers['Authorization'] = \`Bearer \${server.bearer.trim()}\`;
  if (server.sessionId) headers['Mcp-Session-Id'] = server.sessionId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(mcpProxyUrl(server), {method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal});
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) server.sessionId = sid;
    server.lastMcpActivityAt = Date.now();
    if (!res.ok) {
      const raw=await res.text().catch(()=>'');
      if(res.status===401) {
        const authUrl=extractOAuthUrl(res,raw);
        if(authUrl) {
          openOAuthWindow(authUrl,server);
          throw new Error(\`Authentication required for \${server.name}. The OAuth page has been opened outside of chat.\`);
        }
      }
      const err=new Error(raw ? \`HTTP \${res.status}: \${raw.slice(0,180)}\` : \`HTTP \${res.status}\`);
      err.status=res.status;
      err.raw=raw;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('text/event-stream') ? await readSSE(res) : await res.json();
  } catch(err) {
    const e = new Error(err?.name==='AbortError' ? \`MCP timeout after \${Math.round(MCP_REQUEST_TIMEOUT_MS/1000)}s\` : (err?.message || String(err)));
    e.raw = e.message;
    e.status = err?.status;
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function mcpSessionIsStale(server) {
  if(!server?.sessionId) return false;
  const last=Number(server.lastMcpActivityAt || 0);
  return !last || Date.now() - last > MCP_STALE_SESSION_MS;
}

function isMcpSessionOrNetworkFailure(err) {
  const status=err?.status;
  const text=String(err?.raw || err?.message || err || '');
  return status===400 || status===404 || status===409 || status===410 || status===502 || status===503 ||
    /session|mcp-session-id|no valid session|not found|fetch failed|timeout|aborted|terminated|socket|econnreset|econnrefused|und_err/i.test(text);
}

function extractOAuthUrl(response, raw) {
  const candidates=[
    response.headers.get('location'),
    response.headers.get('www-authenticate'),
    raw,
  ].filter(Boolean).join('\\n');
  try {
    const data=raw ? JSON.parse(raw) : null;
    const direct=data?.authorizationUrl||data?.authorization_url||data?.authUrl||data?.auth_url||data?.url||data?.loginUrl||data?.login_url;
    if(typeof direct==='string' && /^https?:\\/\\//i.test(direct)) return direct;
  } catch {}
  const resourceMatch=candidates.match(/resource_metadata="?([^",\\s]+)"?/i);
  if(resourceMatch?.[1] && /^https?:\\/\\//i.test(resourceMatch[1])) return resourceMatch[1];
  const authMatch=candidates.match(/authorization_uri="?([^",\\s]+)"?/i) || candidates.match(/authorization_url="?([^",\\s]+)"?/i);
  if(authMatch?.[1] && /^https?:\\/\\//i.test(authMatch[1])) return authMatch[1];
  const urlMatch=candidates.match(/https?:\\/\\/[^\\s"'<>]+/i);
  return urlMatch?.[0] || '';
}

function openOAuthWindow(url, server) {
  const popup=window.open(url,'mcp-oauth','width=980,height=780');
  if(popup) {
    try { popup.opener=null; } catch {}
    notify(\`OAuth auth opened for \${server.name}. Come back here then reconnect the connector.\`);
  } else {
    notify(\`Popup blocked for \${server.name}. Open the authorization from the browser.\`,'e');
  }
}

async function mcpNotify(server, method, params) {
  const body = {jsonrpc: '2.0', method};
  if (params !== undefined) body.params = params;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (server.bearer?.trim()) headers['Authorization'] = \`Bearer \${server.bearer.trim()}\`;
  if (server.sessionId) headers['Mcp-Session-Id'] = server.sessionId;
  await fetch(mcpProxyUrl(server), {method: 'POST', headers, body: JSON.stringify(body)}).catch(() => {});
}

async function connectServer(id) {
  const s=servers.find(x=>x.id===id); if(!s) return;
  if(!s.url) { notify('Missing URL','e'); return; }
  s.status='loading'; s.sessionId=null; renderCards();
  try {
    await reconnectMCPServer(s);
    notify(\`✓ \${s.name}: \${s.tools.length} tool(s)\`);
  } catch(err) {
    s.status='err'; s.enabled=false;
    showErrModal(\`MCP connection — \${s.name}\`, mcpConnectErrorMessage(err));
  }
  renderCards(); renderTopPills(); saveServers();
}

async function reconnectMCPServer(server) {
  server.sessionId=null;
  const initResp = await mcpRPC(server, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {name: 'WikiChatConnector', version: '0.14.2'}
  });
  if (initResp?.error) throw new Error(initResp.error.message || 'initialize failed');
  await mcpNotify(server, 'notifications/initialized', {});

  const toolsResp = await mcpRPC(server, 'tools/list');
  if (toolsResp?.error) throw new Error(toolsResp.error.message || 'tools/list failed');
  server.tools = toolsResp?.result?.tools || [];
  server.status='ok';
  server.enabled=true;
  server.lastMcpActivityAt=Date.now();
}

async function callMCPTool(name, args, {trackActivity=true}={}) {
  const server=findServerForTool(name);
  if(!server) throw new Error(\`No active MCP server for "\${name}"\`);
  const requestedWorkspace=String(args?.workspace||'').trim();
  if(String(name||'').startsWith('cme_') && name!=='cme_export_cancel' && (!requestedWorkspace||requestedWorkspace==='default')) {
    const wsName=window.__WIKI_CONFIG__?.workspaceName;
    if(wsName) args={...(args||{}),workspace:wsName};
  }
  const tracked=trackActivity&&shouldTrackMcpTool(name,server);
  const source=tracked?activitySourceForTool(name,server):null;
  const activityId=source?\`mcp-\${source}-\${Date.now()}-\${Math.random().toString(36).slice(2,7)}\`:null;
  if(activityId) {
    upsertActivity({
      id:activityId,kind:'mcp',source,sourceLabel:server.name,tool:name,args,
      label:activityToolLabel(name,args),detail:activityArgsSummary(name,args),
      status:'running',startedAt:Date.now(),terminal:false,
    });
  }
  try {
    let resp;
    try {
      if(mcpSessionIsStale(server)) {
        notify(\`\${server.name}: inactive MCP session, reconnecting...\`);
        await reconnectMCPServer(server);
        renderCards(); renderTopPills(); saveServers();
      }
      resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
    } catch(err) {
      if(!isMcpSessionOrNetworkFailure(err)) throw err;
      notify(\`\${server.name}: reconnecting MCP...\`);
      await reconnectMCPServer(server);
      renderCards(); renderTopPills(); saveServers();
      resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
    }
    if (resp?.error && isMcpSessionOrNetworkFailure(resp.error)) {
      notify(\`\${server.name}: expired MCP session, reconnecting...\`);
      await reconnectMCPServer(server);
      renderCards(); renderTopPills(); saveServers();
      resp = await mcpRPC(server, 'tools/call', {name, arguments: args});
    }
    if (resp?.error) throw new Error(resp.error.message || 'Tool call error');
    const content = resp?.result?.content || [];
    const result=content.map(c => c.text ?? JSON.stringify(c)).join('\\n') || JSON.stringify(resp?.result || {});
    ingestMcpActivityResult(name,args,server,result,{activityId});
    return result;
  } catch(error) {
    ingestMcpActivityResult(name,args,server,null,{activityId,error:error?.message||String(error)});
    throw error;
  }
}

function preferredServerNameForTool(name) {
  const text=String(name||'');
  const prefix=text.split('_',1)[0];
  if(prefix && servers.some(s=>s.name===prefix)) return prefix;
  if(text.startsWith('production_')) return 'wiki-production';
  if(text.startsWith('wiki_') || text.startsWith('profile_')) return 'llm-wiki';
  return null;
}

function findServerForTool(name) {
  const preferred=preferredServerNameForTool(name);
  if(preferred) {
    const owner=servers.find(s=>s.name===preferred&&s.enabled&&s.status==='ok'&&s.tools.some(t=>t.name===name));
    if(owner) return owner;
  }
  for(const s of servers)
    if(s.enabled&&s.status==='ok'&&s.tools.some(t=>t.name===name)) return s;
  return null;
}`;
