/**
 * The layout's two draggable separators.
 *
 * Extracted from chatHtml.ts, which had reached its size guard: they form one
 * subject — a pointer drag that writes a width and persists it — and they read
 * better side by side than buried between a send button and a history list.
 *
 * Mirrored rather than generalised: the sidebar grows with clientX, the
 * Activity rail grows as the pointer moves LEFT, and each carries its width on
 * a different element. A shared helper would take more parameters than the
 * lines it saves.
 */
export const SPLITTERS_SCRIPT = String.raw`
function initMainSplitter() {
  const sidebar=$('sidebar'), handle=$('main-resizer');
  if(!sidebar || !handle) return;

  applySidebarOpen(localStorage.getItem(SIDEBAR_OPEN_KEY)!=='0');

  const setSidebarW=(width, persist=false)=>{
    const clamped=Math.max(180, Math.min(width, window.innerWidth-320));
    sidebar.style.setProperty('--sidebar-w', clamped+'px');
    if(persist) localStorage.setItem(MAIN_SPLIT_KEY, String(Math.round(clamped)));
  };

  const saved=Number(localStorage.getItem(MAIN_SPLIT_KEY));
  if(Number.isFinite(saved) && saved>0) setSidebarW(saved);

  handle.addEventListener('pointerdown',e=>{
    if(e.target.closest?.('#sidebar-toggle')) return;
    handle.classList.add('dragging');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    handle.setPointerCapture?.(e.pointerId);
    const move=e=>setSidebarW(e.clientX, true);
    const up=()=>{
      handle.classList.remove('dragging');
      document.body.style.cursor='';
      document.body.style.userSelect='';
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    e.preventDefault();
  });
}

function initActivitySplitter() {
  const panel=$('activity-panel'), handle=$('activity-resizer');
  if(!panel || !handle) return;

  const setActivityW=(width, persist=false)=>{
    // Floor: the run graph and the journal stop being readable below it.
    // Ceiling: leave the conversation at least 40% of the window.
    const clamped=Math.max(280, Math.min(width, Math.max(320, window.innerWidth*0.6)));
    panel.style.setProperty('--act-w', clamped+'px');
    if(persist) localStorage.setItem(ACT_SPLIT_KEY, String(Math.round(clamped)));
  };

  const saved=Number(localStorage.getItem(ACT_SPLIT_KEY));
  if(Number.isFinite(saved) && saved>0) setActivityW(saved);

  handle.addEventListener('pointerdown',e=>{
    handle.classList.add('dragging');
    // The panel animates its width by default; during a drag that lag reads as
    // a broken handle.
    panel.classList.add('resizing');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    handle.setPointerCapture?.(e.pointerId);
    // The rail is anchored right: its width is the distance from the pointer to
    // its own right edge, captured once so the arithmetic stays stable.
    const rightEdge=panel.getBoundingClientRect().right;
    const move=e=>setActivityW(rightEdge-e.clientX, true);
    const up=()=>{
      handle.classList.remove('dragging');
      panel.classList.remove('resizing');
      document.body.style.cursor='';
      document.body.style.userSelect='';
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    e.preventDefault();
  });
}
`;
