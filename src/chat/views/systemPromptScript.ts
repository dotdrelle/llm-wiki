/**
 * The System instructions drawer: an editor of the workspace's
 * `.wiki/system-prompt.md` (GET/PUT /api/system-prompt). Extracted from chatHtml.ts.
 */
export const SYSTEM_PROMPT_SCRIPT = `
function toggleSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  const open=!drawer.classList.contains('open');
  drawer.classList.toggle('open',open);
  drawer.setAttribute('aria-hidden',open?'false':'true');
  btn?.classList.toggle('active',open);
  if(open) {
    // Always the file as it is now: another surface (the ShellUI, an editor)
    // may have changed it since the page loaded.
    loadSystemPromptFile().finally(()=>{
      // Markdown is the reading format, editing is the exception: open in
      // rendered preview by default.
      if(!systemPromptPreviewMode) toggleSystemPromptPreview();
      else $('system-prompt-preview').innerHTML=renderMd($('system-prompt').value||'');
    });
  }
}

let systemPromptDirty=false;
function markSystemPromptDirty(){
  systemPromptDirty=true;
  const btn=$('system-prompt-save-btn'); if(btn) btn.disabled=false;
}
async function loadSystemPromptFile(){
  if(systemPromptDirty) return;
  try {
    const res=await fetch('/api/system-prompt',{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(res.ok&&typeof data.content==='string') $('system-prompt').value=data.content;
  } catch {}
}

function closeSystemPrompt() {
  const drawer=$('system-prompt-drawer'), btn=$('system-drawer-btn');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden','true');
  btn?.classList.remove('active');
}

// Writes .wiki/system-prompt.md: an explicit Save, not every keystroke — the
// file is the workspace's, read by Donna at her next turn.
async function saveSystemPrompt() {
  const btn=$('system-prompt-save-btn');
  if(btn) btn.disabled=true;
  try {
    const res=await fetch('/api/system-prompt',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:$('system-prompt').value})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||\`HTTP \${res.status}\`);
    systemPromptDirty=false;
    $('system-prompt').value=data.content??$('system-prompt').value;
    notify('System instructions saved — used from the next turn');
  } catch(err) {
    if(btn) btn.disabled=false;
    notify('System instructions not saved: '+(err?.message||String(err)),'e');
  }
}

// The drawer edits raw markdown, but the operator reads it rendered — a raw
// textarea made a markdown system prompt look like uninterpreted noise.
// Toggle between the editor and a live rendered view of the same content.
let systemPromptPreviewMode = false;
function toggleSystemPromptPreview() {
  const ta = $('system-prompt'), preview = $('system-prompt-preview'), btn = $('system-prompt-preview-btn');
  if (!ta || !preview || !btn) return;
  systemPromptPreviewMode = !systemPromptPreviewMode;
  if (systemPromptPreviewMode) {
    preview.innerHTML = renderMd(ta.value || '');
    preview.hidden = false;
    ta.hidden = true;
    btn.textContent = 'Edit';
  } else {
    preview.hidden = true;
    ta.hidden = false;
    btn.textContent = 'Preview';
    ta.focus();
  }
}

// Puts the shipped default in the editor; nothing is written before Save.
function resetSystemPrompt() {
  $('system-prompt').value = DEFAULT_SYSTEM_PROMPT;
  if(systemPromptPreviewMode) $('system-prompt-preview').innerHTML=renderMd(DEFAULT_SYSTEM_PROMPT);
  markSystemPromptDirty();
  notify('Default instructions loaded — Save to apply');
}

function currentSystemPrompt() {
  return ($('system-prompt')?.value || '').trim();
}
`;
