import { layout, renderSidebar } from './wikiHtml.ts';

export async function generateSkillsPage(rootDir: string): Promise<string> {
  const sidebar = await renderSidebar(rootDir);
  const pageStyles = `<style>
.skills-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-top:1rem}
.skill-card{background:var(--panel-soft);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.5rem}
.skill-card-name{font-weight:750;font-size:1rem;font-family:monospace;color:var(--accent)}
.skill-card-desc{font-size:.88rem;color:var(--muted)}
.skill-card-params{display:flex;flex-wrap:wrap;gap:.3rem}
.skill-param{background:var(--panel);border:1px solid var(--border);border-radius:99px;font-size:.78rem;padding:2px 8px;color:var(--text);font-family:monospace}
.skill-card-actions{display:flex;gap:.5rem;margin-top:auto;padding-top:.5rem;border-top:1px solid var(--border)}
.skill-card-body-preview{font-size:.82rem;color:var(--muted2);font-family:monospace;white-space:pre-wrap;max-height:4em;overflow:hidden;border-left:2px solid var(--border);padding-left:.5rem;margin-top:.15rem}
.editor-overlay{position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:500;display:none;align-items:flex-start;justify-content:center;padding:3rem 1rem;overflow-y:auto}
.editor-overlay.open{display:flex}
.editor-panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;width:min(640px,100%);padding:1.5rem;display:flex;flex-direction:column;gap:1rem;box-shadow:0 18px 60px rgba(0,0,0,.2)}
.editor-title{font-size:1.05rem;font-weight:750}
.field-label{font-size:.82rem;font-weight:700;color:var(--muted);margin-bottom:.25rem;display:block}
.field-sub{font-size:.78rem;color:var(--muted);margin-top:.2rem}
.field-input,.field-textarea{width:100%;padding:.45rem .65rem;border:1px solid var(--border);border-radius:7px;background:var(--panel-soft);color:var(--text);font:inherit;font-size:.9rem;outline:none;box-sizing:border-box}
.field-input:focus,.field-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.field-textarea{font-family:monospace;font-size:.86rem;min-height:200px;resize:vertical;line-height:1.5}
.editor-actions{display:flex;gap:.5rem;justify-content:flex-end}
.empty-state{padding:2.5rem;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:10px}
.del-btn{color:var(--err) !important;border-color:var(--err) !important}
.del-btn:hover{background:rgba(240,107,107,.08) !important}
</style>`;

  const body = `${sidebar}<main class="content">${pageStyles}
<div class="hero"><h1>Skills</h1><p>Reusable commands invoked with <code style="background:var(--panel-soft);padding:1px 6px;border-radius:4px;font-size:.9em">/name</code> in chat. The skill body fills the message field to run a prepared instruction.</p></div>
<div class="page-actions"><button class="action-button" onclick="openEditor(null)">+ New skill</button></div>
<div id="skills-list"></div>

<div class="editor-overlay" id="editor-overlay" onclick="handleOverlayClick(event)">
  <div class="editor-panel" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div class="editor-title" id="editor-title">New skill</div>
      <button class="action-button" onclick="closeEditor()">✕</button>
    </div>
    <div>
      <label class="field-label" for="f-name">Name <span style="color:var(--err)">*</span></label>
      <input class="field-input" id="f-name" type="text" placeholder="pipeline" pattern="[a-zA-Z0-9_-]{1,60}" autocomplete="off">
      <div class="field-sub">Letters, digits, - and _ only. Invoked as /name in chat.</div>
    </div>
    <div>
      <label class="field-label" for="f-desc">Description</label>
      <input class="field-input" id="f-desc" type="text" placeholder="Run the full pipeline through the production agent">
    </div>
    <div>
      <label class="field-label" for="f-params">Parameters <span style="font-weight:400;color:var(--muted)">(comma-separated)</span></label>
      <input class="field-input" id="f-params" type="text" placeholder="space, template">
      <div class="field-sub">Example: <code style="font-size:.85em">space</code> is referenced in the body as <code style="font-size:.85em">{space}</code>.</div>
    </div>
    <div>
      <label class="field-label" for="f-body">Skill body <span style="color:var(--err)">*</span></label>
      <textarea class="field-textarea" id="f-body" placeholder="Check CME status with cme_status, then run cme_export_run(source_name=&quot;{space}&quot;)..."></textarea>
      <div class="field-sub">Natural-language instructions the LLM will follow. Parameters are inserted as placeholders to replace before sending.</div>
    </div>
    <div class="editor-actions">
      <button class="action-button" onclick="closeEditor()">Cancel</button>
      <button class="action-button" style="background:var(--accent);color:#fff;border-color:var(--accent)" onclick="saveSkill()">Save</button>
    </div>
  </div>
</div>

<script>
let skills=[];

async function loadSkills(){
  const r=await fetch('/api/skills');
  if(!r.ok){document.getElementById('skills-list').innerHTML='<div class="empty-state"><p>Unable to load skills.</p></div>';return;}
  skills=await r.json();
  renderList();
}

function renderList(){
  const el=document.getElementById('skills-list');
  if(!skills.length){
    el.innerHTML='<div class="empty-state"><p>No skills. Create your first skill with the button above.</p></div>';
    return;
  }
  el.innerHTML='<div class="skills-grid">'+skills.map(s=>\`
    <div class="skill-card">
      <div class="skill-card-name">/\${window.WikiUi.escapeHtml(s.name)}</div>
      \${s.description?'<div class="skill-card-desc">'+window.WikiUi.escapeHtml(s.description)+'</div>':''}
      \${s.params&&s.params.length?'<div class="skill-card-params">'+s.params.map(p=>'<span class="skill-param">{'+window.WikiUi.escapeHtml(p)+'}</span>').join('')+'</div>':''}
      \${s.body?'<div class="skill-card-body-preview">'+window.WikiUi.escapeHtml(s.body.slice(0,120))+(s.body.length>120?'…':'')+'</div>':''}
      <div class="skill-card-actions">
        <button class="action-button" onclick="openEditorByIndex(\${i})">Edit</button>
        <button class="action-button del-btn" onclick="deleteSkillByIndex(\${i})">Delete</button>
      </div>
    </div>
  \`).join('')+'</div>';
}

function openEditorByIndex(idx){openEditor(skills[idx]);}

function openEditor(skill){
  document.getElementById('editor-title').textContent=skill?'Edit /'+skill.name:'New skill';
  const nameEl=document.getElementById('f-name');
  nameEl.value=skill?.name??'';
  nameEl.disabled=!!skill;
  document.getElementById('f-desc').value=skill?.description??'';
  document.getElementById('f-params').value=(skill?.params??[]).join(', ');
  document.getElementById('f-body').value=skill?.body??'';
  document.getElementById('editor-overlay').classList.add('open');
  (skill?document.getElementById('f-body'):nameEl).focus();
}

function closeEditor(){document.getElementById('editor-overlay').classList.remove('open');}
function handleOverlayClick(e){if(e.target===document.getElementById('editor-overlay'))closeEditor();}

async function saveSkill(){
  const name=document.getElementById('f-name').value.trim();
  const description=document.getElementById('f-desc').value.trim();
  const params=document.getElementById('f-params').value.split(',').map(p=>p.trim()).filter(Boolean);
  const body=document.getElementById('f-body').value;
  if(!name){alert('Name is required.');return;}
  if(!body.trim()){alert('Skill body is required.');return;}
  const r=await fetch('/api/skills/'+encodeURIComponent(name),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({description,params,body}),
  });
  if(!r.ok){const e=await r.json();alert(e.error||'Error');return;}
  closeEditor();
  await loadSkills();
}

async function deleteSkill(name){
  if(!confirm('Delete skill /'+name+'?'))return;
  await fetch('/api/skills/'+encodeURIComponent(name),{method:'DELETE'});
  await loadSkills();
}

function deleteSkillByIndex(idx){
  const skill=skills[idx];
  if(skill) deleteSkill(skill.name);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEditor();});
loadSkills();
</script>
</main>`;
  return layout('Skills', body);
}
