/*
 * Shared confirmation dialog, replacing the browser's native `confirm()`.
 *
 * `confirm()` is synchronous and unstyled; this module ships one uniform,
 * styled modal that resolves a Promise<boolean> instead, so call sites await it
 * exactly like the native call (just `await confirmAction(...)` instead of
 * `confirm(...)`).
 *
 * The three exports are injected separately because the chat shell, the wiki
 * browser, the skills page and the history page each assemble their own
 * `<style>` / `<body>` / `<script>`, and none shares a whole document with the
 * others. The CSS only uses the `--panel`/`--border`/`--text`/`--muted`/
 * `--accent`/`--panel-soft` custom properties (defined by WIKI_CSS_VARS in
 * every surface), and hard-codes the one danger red, which those surfaces do
 * not otherwise agree on.
 */

export const CONFIRM_DIALOG_CSS = `
.confirm-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center}
.confirm-modal.open{display:flex}
.confirm-modal .confirm-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}
.confirm-dialog{position:relative;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);max-width:460px;width:calc(100% - 48px);padding:20px 22px}
.confirm-dialog.danger{border-color:rgba(210,59,46,.55)}
.confirm-title{font-size:14px;font-weight:700;color:var(--text);margin:0 0 10px}
.confirm-dialog.danger .confirm-title{color:#d23b2e}
.confirm-msg{font-size:13px;line-height:1.55;color:var(--muted);white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.confirm-actions{margin-top:16px;display:flex;justify-content:flex-end;gap:8px}
.confirm-actions button{border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;padding:7px 16px;font-family:inherit}
.confirm-cancel{background:var(--panel-soft);color:var(--text)}
.confirm-cancel:hover{border-color:var(--accent);color:var(--accent)}
.confirm-ok{background:var(--accent);border-color:var(--accent);color:#fff}
.confirm-ok:hover{filter:brightness(1.08)}
.confirm-ok.danger{background:#d23b2e;border-color:#d23b2e}
.confirm-ok.danger:hover{filter:brightness(1.05)}`;

export const CONFIRM_DIALOG_HTML = `
<div class="confirm-modal" id="confirm-modal" aria-hidden="true">
  <div class="confirm-backdrop" data-confirm-cancel></div>
  <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="confirm-title" id="confirm-title"></div>
    <div class="confirm-msg" id="confirm-msg"></div>
    <div class="confirm-actions">
      <button type="button" class="confirm-cancel" id="confirm-cancel">Cancel</button>
      <button type="button" class="confirm-ok" id="confirm-ok">Confirm</button>
    </div>
  </div>
</div>`;

export const CONFIRM_DIALOG_SCRIPT = `
function confirmAction(options){
  const opts=Object.assign({title:'Confirm',message:'',confirmLabel:'Confirm',danger:false},options||{});
  const modal=document.getElementById('confirm-modal');
  if(!modal){ return Promise.resolve(window.confirm(opts.message||opts.title)); }
  return new Promise(function(resolve){
    const dialog=modal.querySelector('.confirm-dialog');
    const titleEl=document.getElementById('confirm-title');
    const msgEl=document.getElementById('confirm-msg');
    const okBtn=document.getElementById('confirm-ok');
    const cancelBtn=document.getElementById('confirm-cancel');
    const backdrop=modal.querySelector('[data-confirm-cancel]');
    dialog.classList.toggle('danger',!!opts.danger);
    titleEl.textContent=opts.title;
    msgEl.textContent=opts.message;
    okBtn.textContent=opts.confirmLabel;
    okBtn.classList.toggle('danger',!!opts.danger);
    let settled=false;
    function settle(result){
      if(settled) return;
      settled=true;
      document.removeEventListener('keydown',onKey);
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      resolve(result);
    }
    function onKey(e){
      if(e.key==='Escape'){ e.preventDefault(); settle(false); }
      else if(e.key==='Enter'){ e.preventDefault(); settle(true); }
    }
    okBtn.onclick=function(){ settle(true); };
    cancelBtn.onclick=function(){ settle(false); };
    backdrop.onclick=function(){ settle(false); };
    document.addEventListener('keydown',onKey);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    cancelBtn.focus();
  });
}`;
