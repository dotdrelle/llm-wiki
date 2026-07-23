export const EMPTY_CHAT_HTML = `<div id="empty">
  <div class="em-icon">⬡</div>
  <h2>Donna</h2>
  <p>Enable an MCP server, then start the conversation.</p>
  <div class="empty-actions">
    <button class="empty-tile help-tile" type="button" onclick="toggleHelpPanel()">
      <span class="empty-tile-title">Help &amp; documentation</span>
      <span class="empty-tile-desc">What this app does, chat vs agent, getting started, and troubleshooting.</span>
    </button>
    <button class="empty-tile" type="button" onclick="submitSuggestion('Help me fill my workspace profile.')">
      <span class="empty-tile-title">Fill workspace profile</span>
      <span class="empty-tile-desc">Describe your context so answers and deliverables fit this workspace.</span>
    </button>
  </div>
</div>`;

export const CHAT_MARKUP = `<aside id="sidebar">
  <div class="shell-tabs" role="tablist" aria-label="Left panel">
    <button id="shell-tab-wiki" class="shell-tab" type="button" role="tab" onclick="setLeftTab('wiki')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>Wiki</button>
    <button id="shell-tab-chat" class="shell-tab active" type="button" role="tab" onclick="setLeftTab('chat')"><span class="shell-tab-glyph" aria-hidden="true">⬡</span>Donna</button>
  </div>
  <div id="wiki-side-host">
    <iframe id="wiki-side-frame" title="Wiki explorer"></iframe>
  </div>
  <div class="sb-logo">
    <div class="sb-logo-mark">⬡</div>
    <div class="sb-logo-main">
      <div class="sb-logo-text">Donna</div>
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
      <a class="sb-link" id="execution-link" href="/chat/execution" onclick="showExecutionView(event)"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg> Execution <span>runtime runs</span></a>
      <div class="sec-label">LLM<div class="sec-label-actions"><select class="tb-profile-select" id="profile-picker" title="Active .wikirc profile managed by wiki-manager runtime" onchange="switchConfigProfile(this.value)"></select><button type="button" onclick="resetYamlConfig()">Reset</button></div></div>
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
<div class="main-resizer" id="main-resizer">
  <button class="sidebar-toggle" id="sidebar-toggle" type="button" onclick="event.stopPropagation();toggleSidebar()" title="Collapse left panel" aria-label="Collapse left panel" aria-expanded="true">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
  </button>
</div>
<div id="main">
  <div id="topbar">
    <span class="tb-model" id="model-badge">gpt-4o</span>
    <div class="tb-mcps" id="tb-mcps"></div>
    <div class="tb-actions">
      <button class="tb-system" id="system-drawer-btn" onclick="toggleSystemPrompt()">System instructions</button>
      <button class="tb-clear" onclick="clearChat()">Clear</button>
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
  <div id="wiki-view">
    <iframe id="wiki-frame" name="wiki-frame" title="Wiki"></iframe>
  </div>
  <div id="wiki-split-resizer" role="separator" aria-orientation="vertical" title="Resize"></div>
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
    <div id="approval-banner" hidden role="alert" aria-live="assertive">
      <span class="approval-banner-icon">⏸</span>
      <span class="approval-banner-text" id="approval-banner-text">Approbation requise avant les mutations.</span>
      <span class="approval-banner-actions">
        <button type="button" class="approval-btn approve" onclick="approveRuntimeRun()">Approuver</button>
        <button type="button" class="approval-btn reject" onclick="rejectRuntimeRun()">Rejeter</button>
      </span>
    </div>
    <div id="page-context-chips" hidden aria-label="Documents shared with Donna as context"></div>
    <div class="input-box" id="input-box">
      <div class="skill-ac" id="skill-ac"></div>
      <input id="doc-upload-input" type="file" hidden accept=".txt,.md,.pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.odt,.odp" onchange="uploadSelectedDocument(this)">
      <textarea id="chat-input" rows="1" placeholder="Your message… (/ for skills)"
        oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <div class="input-actions">
        <button class="attach-btn" type="button" onclick="openDocumentUpload()" title="Upload document" aria-label="Upload document">
          <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
        <button id="agent-mode-btn" class="agent-mode-btn" type="button" onclick="toggleAgentMode()" title="Send prompts to the agent runtime">Agent</button>
        <button id="composer-approve-btn" class="composer-approve-btn" type="button" onclick="approveRuntimeRun()" hidden title="Approve the pending runtime plan">Approuver</button>
        <div class="input-actions-spacer"></div>
        <button id="send-btn" onclick="handleSendButton()" title="Send">
          <svg viewBox="0 0 24 24"><path d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z"/></svg>
        </button>
      </div>
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
    <button class="act-clear-all" type="button" onclick="clearAllActivityTabs()" title="Clear all Activity sections">Clear all</button>
  </div>
  <div class="act-body" id="activity-body"></div>
</aside>

<aside id="help-panel" class="closed" aria-label="Help">
  <div class="act-panel-head">
    <span class="act-panel-title">Documentation</span>
    <div class="help-panel-actions">
      <button class="act-panel-close" id="help-back" type="button" onclick="showHelpToc()" title="All chapters" hidden>←</button>
      <button class="act-panel-close" type="button" onclick="toggleHelpPanel()" title="Close">×</button>
    </div>
  </div>
  <div class="act-body" id="help-body"></div>
</aside>
<aside id="right-rail" aria-label="Monitoring">
  <button class="rail-btn" id="activity-toggle" type="button" onclick="toggleActivityPanel()" title="Activity" aria-label="Activity" aria-expanded="false">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
    <span class="rail-badge" id="rail-act-badge"></span>
  </button>
  <button id="split-toggle" class="rail-btn" type="button" onclick="toggleSplitWiki()" title="Split document + chat" aria-label="Split document + chat">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
  </button>
  <button id="help-toggle" class="rail-btn" type="button" onclick="toggleHelpPanel()" title="Help &amp; documentation" aria-label="Open help">?</button>
  <button id="theme-toggle" class="rail-btn" type="button" onclick="toggleTheme()" title="Switch to dark theme" aria-label="Switch color theme">☾</button>
</aside>
<div id="notif"></div>
<div id="cmdk-backdrop" hidden>
  <div id="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="cmdk-input-row">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="cmdk-input" type="text" placeholder="Search pages, conversations, actions…" autocomplete="off" spellcheck="false">
    </div>
    <div id="cmdk-results" role="listbox"></div>
    <div class="cmdk-hint"><span><kbd>↑↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl+Enter</kbd> add page to context</span><span><kbd>Esc</kbd> close</span></div>
  </div>
</div>
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
