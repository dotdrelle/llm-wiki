/**
 * The report reader: a long result opens beside the chat, never inside it.
 *
 * A report (raw/untracked/Donna/*.md.lock, see services/reportWriter.ts) or a
 * curation proposal (/agent-proposals/<id>) is attached to Donna's one-line
 * message as a button; the button slides this layer in from the right, over
 * the panels, wider than the Help panel so a report is comfortable to read.
 * The thread — and every later model context — keeps only the sentence.
 *
 * The button carries the report's own title (data, in the workspace language);
 * the layer adds no wording of its own beyond the close control.
 */
export const REPORT_READER_HTML = `<aside id="report-reader" aria-hidden="true" aria-label="Report">
  <div class="rr-head"><span class="rr-title"></span><button class="rr-close" type="button" onclick="closeReportReader()" aria-label="Close" title="Close">×</button></div>
  <div class="rr-meta"></div>
  <div class="rr-body"></div>
  <iframe class="rr-frame" title="Report" hidden></iframe>
</aside>`;

export const REPORT_READER_CSS = `
#report-reader{position:fixed;z-index:140;top:0;right:40px;height:100vh;width:min(672px,calc(100vw - 80px));display:flex;flex-direction:column;background:var(--panel);border-left:1px solid var(--border);box-shadow:var(--shadow);transform:translateX(calc(100% + 48px));transition:transform .25s ease;visibility:hidden}
#report-reader.open{transform:none;visibility:visible}
#report-reader .rr-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
#report-reader .rr-title{flex:1;min-width:0;font:700 14px/1.3 var(--font-sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#report-reader .rr-close{border:0;background:none;color:var(--muted);font-size:20px;line-height:1;cursor:pointer}
#report-reader .rr-close:hover{color:var(--text)}
#report-reader .rr-meta{padding:6px 16px;color:var(--muted);font:12px/1.4 var(--font-sans)}
#report-reader .rr-meta:empty{display:none}
#report-reader .rr-body{flex:1;overflow:auto;padding:12px 24px 32px;font-size:14px;line-height:1.6}
#report-reader .rr-body[hidden]{display:none}
#report-reader .rr-frame{flex:1;border:0;width:100%;background:var(--bg)}
.msg-attachments{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.msg-attachment{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel-soft);color:var(--text);font:600 12px var(--font-sans);cursor:pointer}
.msg-attachment:hover{border-color:var(--accent);color:var(--accent)}
.msg-attachment svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.msg-attachment span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;

export const REPORT_READER_SCRIPT = `/* ── Report reader ─────────────────────────────────────────────────── */
const REPORT_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>';
// Report titles remain available in the tooltip and reader heading; the
// visible control stays short enough to scan in the conversation.
function msgAttachmentsHTML(attachments) {
  const list=(Array.isArray(attachments)?attachments:[]).filter(item=>item&&item.target);
  if(!list.length) return '';
  return '<div class="msg-attachments">'+list.map(item=>{const title=item.title||item.target;const label=item.kind==='report'?'Open the report':title;return '<button class="msg-attachment" type="button" data-target="'+esc(item.target)+'" data-title="'+esc(title)+'" onclick="openReportReader(this.dataset.target,this.dataset.title)" title="'+esc(title)+'">'+REPORT_ICON+'<span>'+esc(label)+'</span></button>';}).join('')+'</div>';
}
function attachMsgAttachments(el, attachments) {
  if(!el||el.querySelector('.msg-attachments')) return;
  const html=msgAttachmentsHTML(attachments);
  if(html) el.querySelector('.msg-content .bubble')?.insertAdjacentHTML('afterend',html);
}
// A Markdown report reads in the layer itself; any other served page (a
// curation proposal) in a frame.
async function openReportReader(target, title) {
  const panel=$('report-reader');
  if(!panel||!target) return;
  const body=panel.querySelector('.rr-body'), frame=panel.querySelector('.rr-frame'), meta=panel.querySelector('.rr-meta');
  panel.querySelector('.rr-title').textContent=title||target;
  meta.textContent='';
  panel.classList.add('open'); panel.setAttribute('aria-hidden','false');
  if(!/^raw\\/untracked\\/.+\\.md(?:\\.lock)?$/.test(String(target))) {
    body.hidden=true; frame.hidden=false; frame.src=target;
    return;
  }
  frame.hidden=true; frame.removeAttribute('src'); body.hidden=false;
  body.innerHTML='<div class="help-loading">Loading…</div>';
  try {
    const r=await fetch('/api/report?path='+encodeURIComponent(target),{cache:'no-store'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    const fm=/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n/.exec(d.markdown||'');
    const front=fm?fm[1]:'';
    const at=/\\bat:\\s*['"]?([^'"\\n]+)/.exec(front)?.[1];
    meta.textContent=[d.path, at?formatLocalDateTime(at):''].filter(Boolean).join(' · ');
    body.innerHTML='<div class="help-article">'+renderMd(fm?(d.markdown||'').slice(fm[0].length):(d.markdown||''))+'</div>';
    addReportContents(body.querySelector('.help-article'));
    body.scrollTop=0;
  } catch(e) { body.innerHTML='<div class="help-loading">'+esc(e?.message||String(e))+'</div>'; }
}
// A report of three sections or more opens on its contents, drawn from the
// headings already rendered: text only, never markup.
function addReportContents(article) {
  const heads=[...(article?.querySelectorAll('h2,h3')||[])];
  if(heads.length<3) return;
  const nav=document.createElement('nav'); nav.className='rr-toc'; nav.setAttribute('aria-label','Contents');
  for(const head of heads) {
    const link=document.createElement('button'); link.type='button'; link.textContent=head.textContent;
    if(head.tagName==='H3') link.className='sub';
    link.addEventListener('click',()=>head.scrollIntoView({behavior:'smooth',block:'start'}));
    nav.appendChild(link);
  }
  article.prepend(nav);
}
function closeReportReader() {
  const panel=$('report-reader');
  if(!panel) return;
  panel.classList.remove('open'); panel.setAttribute('aria-hidden','true');
  const frame=panel.querySelector('.rr-frame');
  if(frame) frame.removeAttribute('src');
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('report-reader')?.classList.contains('open')) closeReportReader(); });
/* ── end Report reader ───────────────────────────────────────────── */`;
