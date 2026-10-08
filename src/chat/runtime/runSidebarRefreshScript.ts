export const RUN_SIDEBAR_REFRESH_SCRIPT = `// The wiki sidebar is server-rendered and only knows to poll while a job's
// marker is already in its DOM, so a run that starts and finishes between two
// of its refreshes never arms it. The shell owns the runtime stream, so it tells
// the sidebar to re-fetch at every run boundary and keeps it fresh while the run
// lasts. A lightweight in-place refresh (llmwiki:refresh) is preferred over
// reloading the iframe: it preserves the reader's scroll and open folders.
//
// The keep-fresh tick follows STATE, not only the run_started event: a page
// opened mid-run never saw that event, and maintenance works outside Donna's
// runs (no run_started at all) — the counters stayed frozen until a manual
// refresh for a whole 44-source ingest. Either source keeps the tick alive;
// the last one to stop triggers one final refresh.
let runSidebarRefreshTimer=null;
let runSidebarDonnaActive=false;
let runSidebarMaintenanceActive=false;
function refreshRunSidebar() {
  const frame=document.getElementById('wiki-side-frame');
  try { frame?.contentWindow?.postMessage({type:'llmwiki:refresh'},location.origin); } catch {}
}
function syncRunSidebarRefresh() {
  const active=runSidebarDonnaActive||runSidebarMaintenanceActive;
  if(active&&!runSidebarRefreshTimer) {
    refreshRunSidebar();
    runSidebarRefreshTimer=setInterval(refreshRunSidebar,4000);
  } else if(!active&&runSidebarRefreshTimer) {
    clearInterval(runSidebarRefreshTimer);runSidebarRefreshTimer=null;
    refreshRunSidebar();
  }
}
function noteRunSidebarState(state) {
  runSidebarDonnaActive=['running','pending_approval','waiting'].includes(String(state?.status||'').toLowerCase());
  syncRunSidebarRefresh();
}
window.noteMaintenanceSidebarActivity=(running)=>{
  runSidebarMaintenanceActive=Boolean(running);
  syncRunSidebarRefresh();
};
function noteRunSidebarEvent(type) {
  if(type==='run_started') {
    runSidebarDonnaActive=true;
    syncRunSidebarRefresh();
    return;
  }
  if(type==='run_done'||type==='run_error'||type==='run_cancelled') {
    runSidebarDonnaActive=false;
    if(runSidebarRefreshTimer&&!runSidebarMaintenanceActive) syncRunSidebarRefresh();
    else refreshRunSidebar();
    return;
  }
  if(type==='task.started'||type==='task.completed'||type==='run_pending_approval') {
    refreshRunSidebar();
  }
}
`;
