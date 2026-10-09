/**
 * The workspace's containers in one line, in the Run execution canvas's
 * top-right corner: CPU, memory and network summed over the workspace's own
 * Compose project, like `docker stats` folded into a total (the per-container
 * figures are in the tooltip).
 *
 * The runtime keeps one shared `docker stats` stream per watched workspace
 * and stops it 30 s after the last request (llm-wiki-manager
 * `runtime/containerStats.js`), so this side only asks while the line is on
 * screen: never in a hidden tab, never while the graph is closed, at most one
 * request in flight, one every 5 s.
 */
// Starts on a newline: it is concatenated into the chat script.
export const CONTAINER_STATS_SCRIPT = `
const CONTAINER_STATS_EVERY_MS=5000;
let containerStatsLast=null;
let containerStatsAskedAt=0;
let containerStatsInFlight=false;
let containerStatsTimer=null;
function containerStatsBytes(value) {
  const n=Number(value)||0;
  const units=['B','KiB','MiB','GiB','TiB'];
  let i=0,v=n;
  while(v>=1024&&i<units.length-1){v/=1024;i++;}
  return (i===0?String(Math.round(v)):v.toFixed(v>=100?0:1))+' '+units[i];
}
function containerStatsText(stats) {
  if(!stats) return {text:'Containers…',title:''};
  if(stats.state==='unavailable') return {text:'Container stats unavailable',title:String(stats.error||'')};
  if(stats.state==='empty') return {text:(stats.project||'Workspace')+' · no container running',title:''};
  if(stats.state!=='live') return {text:(stats.project||'Workspace')+' · reading docker stats…',title:''};
  const count=Number(stats.containers)||0;
  const mem=containerStatsBytes(stats.memUsedBytes)+(Number(stats.memLimitBytes)>0?' / '+containerStatsBytes(stats.memLimitBytes):'');
  const text=[stats.project,count+' container'+(count>1?'s':''),'CPU '+(Number(stats.cpuPercent)||0).toFixed(1)+'%','MEM '+mem,'NET ↓'+containerStatsBytes(stats.netRxBytes)+' ↑'+containerStatsBytes(stats.netTxBytes)].filter(Boolean).join(' · ');
  const title=(Array.isArray(stats.perContainer)?stats.perContainer:[])
    .map(item=>item.name+' — CPU '+(Number(item.cpuPercent)||0).toFixed(1)+'% · MEM '+containerStatsBytes(item.memUsedBytes)).join('\\n');
  return {text,title};
}
function renderContainerStats(el) {
  const {text,title}=containerStatsText(containerStatsLast);
  if(el.textContent!==text) el.textContent=text;
  if(el.title!==title) el.title=title;
  el.classList.toggle('unavailable',containerStatsLast?.state==='unavailable');
  el.hidden=false;
}
async function tickContainerStats() {
  const el=$('runtime-graph-stats');
  // On screen only: the graph frame exists, is laid out, and the tab is seen.
  // The line itself starts hidden, so its canvas stage is what is checked.
  const stage=el?.parentElement;
  if(!el||!stage||stage.offsetParent===null||document.hidden) return;
  renderContainerStats(el);
  if(containerStatsInFlight||Date.now()-containerStatsAskedAt<CONTAINER_STATS_EVERY_MS) return;
  containerStatsInFlight=true;
  containerStatsAskedAt=Date.now();
  try {
    const res=await fetch('/api/runtime/workspace-stats',{cache:'no-store'});
    const data=await res.json().catch(()=>null);
    containerStatsLast=res.ok&&data?data:{state:'unavailable',error:(data&&data.error)||('runtime answered '+res.status)};
  } catch(error) {
    containerStatsLast={state:'unavailable',error:'runtime unreachable'};
  } finally {
    containerStatsInFlight=false;
  }
  const current=$('runtime-graph-stats');
  if(current) renderContainerStats(current);
}
function startContainerStats() {
  if(containerStatsTimer) return;
  // A cheap 1 s check (is the line on screen?) — the request itself is spaced
  // by CONTAINER_STATS_EVERY_MS.
  containerStatsTimer=setInterval(()=>{ void tickContainerStats(); },1000);
}`;
