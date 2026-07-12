export const EMPTY_CHAT_HTML = `<div id="empty">
  <div class="em-icon">⬡</div>
  <h2>MCP Chat</h2>
  <p>Enable an MCP server, then start the conversation.</p>
  <div class="empty-actions">
    <button class="empty-tile setup-guide-tile" type="button" onclick="submitSuggestion('/guide')">
      <span class="empty-tile-title">Start setup guide</span>
      <span class="empty-tile-desc">Let Donna check LLM, connectors, sources, wiki content, and deliverables.</span>
    </button>
    <button class="empty-tile" type="button" onclick="submitSuggestion('Help me fill my workspace profile.')">
      <span class="empty-tile-title">Fill workspace profile</span>
      <span class="empty-tile-desc">Describe your context so answers and deliverables fit this workspace.</span>
    </button>
    <button class="empty-tile wide" type="button" onclick="submitSuggestion(getTipsPrompt())">
      <span class="empty-tile-title">Get contextual tips</span>
      <span class="empty-tile-desc">Donna checks the workspace state and gives 3 specific next-step suggestions.</span>
    </button>
  </div>
</div>`;

export const CHAT_MARKUP = `<nav id="app-nav" aria-label="Navigation application">
  <button class="app-nav-btn" type="button" onclick="toggleSidebar()" title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
  <a class="app-nav-link" href="/" title="Back to wiki" aria-label="Back to wiki">Wiki</a>
  <button class="app-nav-link" type="button" onclick="showChatView()" title="Chat">Chat</button>
  <button class="app-nav-link" type="button" onclick="showExecutionView()" title="Execution">Execution</button>
  <div class="app-nav-title">MCP Chat</div>
  <div class="app-nav-spacer"></div>
  <button id="theme-toggle" class="app-nav-btn theme-toggle" type="button" onclick="toggleTheme()" title="Switch to dark theme" aria-label="Switch color theme">☾</button>
</nav>

<aside id="sidebar">
  <div class="sb-logo">
    <div class="sb-logo-mark">M</div>
    <div class="sb-logo-main">
      <div class="sb-logo-text">MCP Chat</div>
      <div class="sb-logo-sub">workspace chat</div>
    </div>
  </div>
  <div class="sb-scroll" id="sidebar-split">
    <div class="sb-pane history-pane" id="history-pane">
      <div class="sec-label">
        Conversations
        <button onclick="newConversation()">+ New</button>
      </div>
      <div class="history-list" id="history-list">
        <div class="history-empty">No history.</div>
      </div>
    </div>
    <div class="sb-resizer" id="sidebar-resizer" title="Resize panels"></div>
    <div class="sb-pane config-pane" id="config-pane">
      <div class="sec-label">Connectors</div>
      <a class="sb-link" id="connectors-link" href="/chat/connectors" onclick="showConnectorsView(event)"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/></svg> Connectors <span>MCP & skills</span></a>
      <div class="sec-label">LLM Config<div class="sec-label-actions"><select class="tb-profile-select" id="profile-picker" title="Active .wikirc profile managed by wiki-manager runtime" onchange="switchConfigProfile(this.value)"></select><button type="button" onclick="resetYamlConfig()">Reset</button></div></div>
      <div class="api-block">
        <div class="field">
          <label>Base URL</label>
          <input id="base-url" type="text" placeholder="http://localhost:11434/v1" onchange="saveConfig()">
        </div>
        <div class="field">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <label style="margin:0">API Key</label>
            <span class="key-saved" id="llm-saved">saved</span>
          </div>
          <div class="secret-wrap">
            <input id="api-key" type="password" placeholder="sk-… (leave empty for Ollama)" autocomplete="off" onchange="saveConfig()">
            <div class="secret-actions">
              <button class="secret-btn" id="reveal-btn-apikey" onclick="toggleReveal('api-key',this)" title="Show/hide">
                <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Model</label>
            <input id="model-name" type="text" placeholder="gpt-4o" oninput="syncModel()" onchange="saveConfig()">
          </div>
          <div class="field">
            <label>Temp.</label>
            <input id="temperature" type="number" value="0.7" min="0" max="2" step="0.1" onchange="saveConfig()">
          </div>
        </div>
      </div>
    </div>
  </div>
</aside>
<div class="main-resizer" id="main-resizer"></div>
<div id="main">
  <div id="topbar">
    <span class="tb-model" id="model-badge">gpt-4o</span>
    <div class="tb-mcps" id="tb-mcps"></div>
    <div class="tb-actions">
      <button class="tb-system" id="system-drawer-btn" onclick="toggleSystemPrompt()">System instructions</button>
      <button class="tb-clear" onclick="clearChat()">Clear</button>
      <button class="tb-act-btn" id="tb-act-btn" onclick="toggleActivityPanel()" title="Activity">
        Activity<span class="tb-act-badge" id="tb-act-badge"></span>
      </button>
    </div>
  </div>
  <div class="connectors-view" id="connectors-view">
    <div class="connectors-head">
      <div class="connectors-title">
        <h1>Connectors</h1>
        <p>Enable MCP endpoints and prepare your reusable skills for chat.</p>
      </div>
    </div>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>MCP Connectors</h2>
          <p>Enable available connectors, add your MCP endpoints, then return to chat to use their tools.</p>
        </div>
        <button class="connectors-add" type="button" onclick="addServer()">+ Add</button>
      </div>
      <div class="connectors-grid">
        <div class="mcp-cards" id="mcp-cards"></div>
      </div>
    </section>
    <section class="connectors-section">
      <div class="connectors-section-head">
        <div class="connectors-section-title">
          <h2>Skills</h2>
          <p>Create prepared prompts and insert them into chat with <strong>/</strong>.</p>
        </div>
        <button class="connectors-add" type="button" onclick="openSkillEditor()">+ New skill</button>
      </div>
      <div id="skills-manager-list"></div>
      <div class="skill-editor" id="skill-editor">
        <div class="skill-editor-title" id="skill-editor-title">New skill</div>
        <div class="skill-editor-row">
          <div>
            <label for="skill-name">Name</label>
            <input id="skill-name" type="text" placeholder="pipeline" autocomplete="off">
          </div>
          <div>
            <label for="skill-params">Parameters</label>
            <input id="skill-params" type="text" placeholder="space, template">
          </div>
        </div>
        <div>
          <label for="skill-desc">Description</label>
          <input id="skill-desc" type="text" placeholder="Run the full pipeline via the production agent">
        </div>
        <div>
          <label for="skill-body">Skill body</label>
          <textarea id="skill-body" placeholder="Check status, then run the requested job..."></textarea>
        </div>
        <div class="skill-editor-actions">
          <button class="skill-manager-btn" type="button" onclick="closeSkillEditor()">Cancel</button>
          <button class="skill-manager-btn" type="button" onclick="saveSkillFromEditor()">Save</button>
        </div>
      </div>
    </section>
  </div>
  <div id="messages">
    ${EMPTY_CHAT_HTML}
  </div>
  <div class="execution-view" id="execution-view">
    <div class="execution-head">
      <h1>Execution</h1>
      <p>Run, tasks, agents, MCP calls and outputs from the canonical runtime workflow projection.</p>
    </div>
    <div id="runtime-graph-center"></div>
  </div>
  <div id="input-wrap">
    <div class="input-box">
      <div class="skill-ac" id="skill-ac"></div>
      <input id="doc-upload-input" type="file" hidden onchange="uploadSelectedDocument(this)">
      <textarea id="chat-input" rows="1" placeholder="Your message… (/ for skills)"
        oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <button id="agent-mode-btn" class="agent-mode-btn" type="button" onclick="toggleAgentMode()" title="Send prompts to the agent runtime">Agent</button>
      <button class="attach-btn" type="button" onclick="openDocumentUpload()" title="Upload document" aria-label="Upload document">
        <svg viewBox="0 0 24 24"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7L9.2 18.2a2 2 0 0 1-2.8-2.8l9.2-9.2"/></svg>
      </button>
      <button id="send-btn" onclick="handleSendButton()" title="Send">
        <svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>
      </button>
    </div>
    <div class="input-hint">Enter to send · Shift+Enter for new line</div>
  </div>
</div>

<aside id="activity-panel" class="closed">
  <div class="act-panel-head">
    <span class="act-panel-title">Activity</span>
    <div class="act-view-tabs" role="tablist" aria-label="Activity view">
      <button class="act-view-tab active" id="act-view-list" type="button" onclick="setActivityView('list')">List</button>
      <button class="act-view-tab" id="act-view-graph" type="button" onclick="setActivityView('graph')">Graph</button>
    </div>
    <button class="act-panel-close" onclick="toggleActivityPanel()" title="Close">×</button>
  </div>
  <div class="act-body" id="activity-body"></div>
</aside>
<div id="notif"></div>
<div class="prompt-drawer" id="system-prompt-drawer" aria-hidden="true">
  <div class="prompt-backdrop" onclick="closeSystemPrompt()"></div>
  <aside class="prompt-panel" aria-label="System instructions">
    <div class="prompt-head">
      <div class="prompt-title">
        <h2>System instructions</h2>
        <p>Injected into the model on every call, without appearing in history.</p>
      </div>
      <button class="prompt-close" type="button" onclick="closeSystemPrompt()" title="Close">×</button>
    </div>
    <div class="prompt-body">
      <textarea id="system-prompt" spellcheck="false" onchange="saveSystemPrompt()" oninput="saveSystemPrompt()"></textarea>
      <div class="prompt-actions">
        <button type="button" onclick="resetSystemPrompt()">Reset</button>
      </div>
    </div>
  </aside>
</div>
<div class="doc-modal" id="doc-modal" aria-hidden="true">
  <div class="doc-backdrop" onclick="closeLocalDoc()"></div>
  <section class="doc-panel" role="dialog" aria-modal="true" aria-labelledby="doc-title">
    <div class="doc-head">
      <div class="doc-title" id="doc-title">Document</div>
      <a class="doc-open" id="doc-open" href="#" target="_blank" rel="noopener">Open</a>
      <button class="doc-close" type="button" onclick="closeLocalDoc()" title="Close">×</button>
    </div>
    <div class="doc-content" id="doc-content"></div>
  </section>
</div>
<div class="err-modal" id="err-modal" aria-hidden="true">
  <div class="err-backdrop" onclick="closeErrModal()"></div>
  <div class="err-dialog" role="dialog" aria-modal="true">
    <div class="err-dialog-title" id="err-modal-title">Error</div>
    <div class="err-dialog-msg" id="err-modal-msg"></div>
    <div class="err-dialog-foot"><button onclick="closeErrModal()">Close</button></div>
  </div>
</div>
`;
