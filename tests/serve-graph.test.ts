import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderWikiGraphV2 } from '../src/graph/wiki/graphApp.ts';

it('keeps the graph document preview viewport-sized and scrolls its content', () => {
  const source = renderWikiGraphV2();
  expect(source).toContain('max-height:calc(100vh - 64px)');
  expect(source).toContain('.document-preview-content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain');
});

async function serveSource(): Promise<string> {
  const [serve, html, css, script] = await Promise.all([
    readFile(path.resolve(import.meta.dirname, '../src/commands/serve.ts'), 'utf8'),
    readFile(path.resolve(import.meta.dirname, '../src/serve/html/wikiHtml.ts'), 'utf8'),
    readFile(path.resolve(import.meta.dirname, '../src/serve/html/wikiLayoutCss.ts'), 'utf8'),
    readFile(path.resolve(import.meta.dirname, '../src/serve/html/wikiLayoutScript.ts'), 'utf8'),
  ]);
  return `${serve}\n${html}\n${css}\n${script}`;
}

it('follows the shared serve theme without rendering a redundant graph toggle', () => {
  const html = renderWikiGraphV2();
  expect(html).toContain("const THEME_KEY='llm-wiki:theme'");
  expect(html).toContain("localStorage.getItem(THEME_KEY)||'dark'");
  expect(html).toContain('event.key===THEME_KEY&&event.newValue');
  expect(html).not.toContain('id="theme-toggle"');
  expect(html).not.toContain("localStorage.setItem(THEME_KEY,theme)");
});

it('centers the inspector toggle and hides all content when collapsed', () => {
  const html = renderWikiGraphV2();
  expect(html).toContain('.inspector-collapsed .inspector-toggle{align-self:center;float:none;margin:0}');
  expect(html).toContain('.inspector-collapsed .inspector>:not(.inspector-toggle){display:none!important}');
});

it('shares the selected color theme with wiki home', async () => {
  const source = await serveSource();
  expect(source).toContain('data-theme-toggle');
  expect(source).toContain("const THEME_KEY = 'llm-wiki:theme';");
  expect(source).toContain("localStorage.getItem('llm-wiki:graph:theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')");
  expect(source).toContain('event.key === THEME_KEY && event.newValue');
  expect(source).toContain(":root.theme-dark .sidebar");
});

async function runtimeEventsSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/sse/runtimeEvents.ts'), 'utf8');
}

async function runtimeRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/runtimeRoutes.ts'), 'utf8');
}

async function graphRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/graphRoutes.ts'), 'utf8');
}

async function uploadRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/uploadRoutes.ts'), 'utf8');
}

async function configRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/configRoutes.ts'), 'utf8');
}

async function chatRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/chatRoutes.ts'), 'utf8');
}

async function wikiRoutesSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/serve/routes/wikiRoutes.ts'), 'utf8');
}

async function graphProjectionSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/graph/wiki/projection.ts'), 'utf8');
}

async function graphForceSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/graph/core/graphForce.ts'), 'utf8');
}

async function runtimeGraphSource(): Promise<string> {
  return readFile(path.resolve(import.meta.dirname, '../src/chat/runtime/runtimeGraphScript.ts'), 'utf8');
}

describe('serve graph ui', () => {
  it('fits the graph content to the page on the initial map render', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('function fitCurrentSvg(maxZoom=Infinity)');
    expect(html).toContain('bounds=visibleRootBounds(svg,root)');
    expect(html).toContain('mapViewBox=fitCurrentSvg()');
    expect(html).not.toContain("[-w*.75,-h*.75,w*2.5,h*2.5].join(' ')");
  });

  it('renders sidebar chat and graph actions as two wide buttons', async () => {
    const source = await serveSource();

    expect(source).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(source).toContain('min-height: 2.75rem;');
    expect(source).toContain('<span>Chat</span>');
    expect(source).toContain('<span>Graph</span>');
    expect(source).toContain('class="wiki-help-toggle" href="/help"');
    expect(source).toContain('aria-label="Help">?</a>');
    expect(source).not.toContain('<span>Help</span>');
    expect(source).toContain("event.target instanceof Element ? event.target.closest('a[href]') : null");
    expect(source).toContain('window.WikiUi.navigate(href);');
    expect(source).toContain('html.sidebar-panel .side-head .side-actions{width:calc(50% - .25rem)}');
    expect(source).toContain('html.sidebar-panel .side-head .side-action{width:100%}');
  });

  it('renders a persistent draggable main sidebar resizer', async () => {
    const source = await serveSource();

    expect(source).toContain('grid-template-columns: var(--wiki-sidebar-w, 280px) 6px minmax(0, 1fr);');
    expect(source).toContain('class="wiki-main-resizer" data-wiki-main-resizer');
    expect(source).toContain('role="separator" aria-orientation="vertical"');
    expect(source).toContain('function initMainSidebarResizer()');
    expect(source).toContain("const WKEY = 'llm-wiki:sidebar:width';");
    expect(source).toContain('return Math.max(220, Math.min(px, window.innerWidth - 420));');
    expect(source).toContain("shell.style.setProperty('--wiki-sidebar-w', v + 'px');");
    expect(source).toContain("document.body.style.cursor = 'col-resize';");
  });

  it('keeps the embedded document TOC visible beside shell panels', async () => {
    const source = await serveSource();

    expect(source).toContain('html.is-embedded:not(.sidebar-panel) .content:has(.doc-toc)');
    expect(source).toContain('padding-right:clamp(145px,26vw,240px)');
    expect(source).toContain('html.is-embedded:not(.sidebar-panel) .doc-toc{display:flex;right:.75rem;width:clamp(120px,22vw,200px)}');
    expect(source).toContain('const top = Math.max(16, article.getBoundingClientRect().top);');
    expect(source).toContain("toc.style.top = top + 'px';");
  });

  it('keeps long breadcrumbs and document actions on one line in the shell', async () => {
    const source = await serveSource();

    expect(source).toContain('flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;');
    expect(source).toContain('flex-shrink: 0; flex-wrap: nowrap;');
    expect(source).toContain('html.is-embedded:not(.sidebar-panel) .topbar{display:flex;flex-wrap:nowrap}');
  });

  it('renders a persistent draggable Pending panel resizer', async () => {
    const source = await serveSource();

    expect(source).toContain('data-pending-resizer');
    expect(source).toContain("role=\"separator\" aria-orientation=\"horizontal\"");
    expect(source).toContain('flex: 0 0 var(--pending-height, 32vh);');
    expect(source).toContain("const PKEY = 'llm-wiki:sidebar:pendingHeight';");
    expect(source).toContain('startH + (startY - e.clientY)');
    expect(source).toContain("panel.addEventListener('toggle', syncResizer);");
  });

  it('offers explicit refresh actions for Wiki and Pending', async () => {
    const source = await serveSource();
    expect(source).toContain('title="Refresh Wiki"');
    expect(source).toContain('title="Refresh Pending"');
    expect(source).toContain('data-sidebar-refresh="wiki"');
    expect(source).toContain('data-sidebar-refresh="pending"');
    expect(source).toContain("fetch('/embed/sidebar', { cache: 'no-store' })");
    expect(source).toContain("if (target === 'pending')");
    expect(source).toContain("else if (target === 'wiki')");
    expect(source).not.toContain('window.location.reload();');
  });

  it('visually distinguishes the primary Wiki tree from output collections', async () => {
    const source = await serveSource();
    expect(source).toContain("node.name === 'wiki' ? ' side-folder-primary' : ''");
    expect(source).toContain('.side-folder-primary {');
  });

  it('collapses deliverables, templates, and build context by default', async () => {
    const source = await serveSource();
    expect(source).toContain("new Set(['deliverables', 'templates', 'build-context'])");
    expect(source).toContain("depth === 0 && !collapsedByDefault.has(node.name) ? ' open' : ''");
  });

  it('wraps long document lines and gives the first table column a bounded width', async () => {
    const source = await serveSource();
    expect(source).toContain('white-space: pre-wrap; overflow-wrap: anywhere;');
    expect(source).toContain('table-layout: fixed;');
    expect(source).toContain('th:first-child, td:first-child { width: clamp(8rem, 24%, 14rem); }');
  });

  it('opens Pending markdown in the editor and keeps save/cancel on valid routes', async () => {
    const source = `${await serveSource()}\n${await wikiRoutesSource()}`;

    expect(source).toContain('href="${escapeHref(`/${file}`)}"');
    expect(source).toContain('title="${safePath}"');
    expect(source).toContain("const cancelHref = isRawUntrackedReference(cleanRelativePath) ? '/'");
    expect(source).toContain('const redirectAfterSave = isRawUntrackedReference(savedRelative)');
    expect(source).toContain("? escapeHref(`/edit/${savedRelative}`)");
  });

  it('groups concept tiles from frontmatter or concept subfolders', async () => {
    const source = await serveSource();

    expect(source).toContain('async function hydrateConceptTileGroups');
    expect(source).toContain("parsed.data.group");
    expect(source).toContain("href.startsWith('/wiki/concepts/')");
    expect(source).toContain('await hydrateConceptTileGroups(rootDir, indexTiles);');
    expect(source).toContain('section-browser-group');
  });

  it('uses concept groups and wiki links in graph data', async () => {
    const source = await graphProjectionSource();

    expect(source).toContain('function graphWikiTargetPath');
    expect(source).toContain('extractWikiLinks(markdown)');
    expect(source).toContain('function graphCommunityMetadata');
    expect(source).toContain('assignGraphCommunities');
    expect(source).toContain('group: groups.get(file)');
    expect(source).toContain('secondary: groups.get(file)');
    expect(source).toContain('uses_template');
    expect(source).toContain('uses_context');
    expect(source).toContain('generated_from');
  });

  it('routes the lightweight graph v2 APIs through the extracted graph route module', async () => {
    const source = await serveSource();
    const routesSource = await graphRoutesSource();
    const graphHtml = renderWikiGraphV2();

    expect(source).toContain('handleGraphRoutes(req, res, urlPath');
    expect(source).toContain('buildWikiGraph(rootDir');
    expect(source).toContain('renderWikiGraphV2()');
    expect(source).toContain('buildGraphOverview');
    expect(source).toContain('{ includeContent: false, concurrency: 8, fallbackCommunityLabel }');
    expect(routesSource).not.toContain("urlPath === '/api/graph-etag'");
    expect(routesSource).not.toContain("urlPath === '/api/graph-data'");
    expect(routesSource).toContain("urlPath === '/api/graph/overview'");
    expect(routesSource).toContain("urlPath === '/api/graph/community'");
    expect(routesSource).toContain("urlPath === '/api/graph/document'");
    expect(routesSource).not.toContain("urlPath === '/api/graph/dag'");
    expect(routesSource).toContain("urlPath === '/api/graph/list'");
    expect(routesSource).toContain("urlPath === '/graph'");
    expect(routesSource).toContain('structureEtag: current.structureEtag');
    expect(routesSource).toContain('topologyEtag: current.topologyEtag');
    expect(routesSource).toContain('workspaceNameFromEnv');
    expect(graphHtml).toContain("n.community?.communityLabel||'—'");
    expect(graphHtml).toContain("function nodePositionKey(id){return 'llm-wiki:graph:node:'+encodeURIComponent(data?.workspace||'wiki')+':'+id}");
    expect(graphHtml).not.toContain("localStorage.setItem('llm-wiki:graph:node:'+n.id");
  });

  it('renders Community through its dedicated deterministic renderer', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('function renderCommunityView()');
    expect(html).toContain("if(view==='focus'){renderFocus()");
    expect(html).toContain('renderCommunityView()}');
    expect(html).toContain('data.communityEdges||[]');
    expect(html).toContain("communityExpanded.has(c.id)?' is-expanded':'");
    expect(html).not.toContain('function renderCommunityView(){const simulation=d3.forceSimulation');
  });

  it('supports Community expansion, isolation, semantic shapes and zoom tiers', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('if(!event.shiftKey)communityExpanded.clear()');
    expect(html).toContain(".on('dblclick',(event,c)=>");
    expect(html).toContain('isolatedCommunity=c.id');
    expect(html).toContain("isolatedCommunity?'near':'far'");
    expect(html).toContain("isolatedCommunity?'near':event.transform.k<.8");
    expect(html).toContain("node.type==='raw-source'?'none':color");
    expect(html).toContain("node.type==='wiki-source'");
    expect(html).toContain("node.type==='template'||node.type==='build-context'");
    expect(html).toContain("node.type==='deliverable'?'rect':'path'");
    expect(html).toContain("node.type==='wiki'?'circle'");
    expect(html).toContain(".attr('stroke',color)");
    expect(html).not.toContain('.community-v3-node-shape{stroke:var(--bg)');
    expect(html).toContain("event.transform.k<.8?'far':event.transform.k<1.65?'medium':'near'");
  });

  it('persists dragged Community positions per workspace and topology', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("'llm-wiki:graph:community:'+encodeURIComponent(data?.workspace||'wiki')+':'+id");
    expect(html).toContain('saved?.topologyEtag===data?.topologyEtag');
    expect(html).toContain('topologyEtag:data.topologyEtag');
    expect(html).toContain(".on('end',(_,c)=>saveCommunityPosition(c.id,positions.get(c.id)))");
  });

  it('restores the Community overview cleanly after isolation', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('communityExpandedBeforeIsolation.forEach(id=>communityExpanded.add(id))');
    expect(html).toContain('isolatedCommunity=null;selected=null;selectedCommunity=null;communityZoom=d3.zoomIdentity');
    expect(html).toContain('focusHistory.length=0');
  });

  it('refits the visible Community subset after filters and resets its zoom state', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("if(view==='community')communityZoom=d3.zoomIdentity");
    expect(html).toContain("if(view==='community')requestAnimationFrame(()=>fitCurrentSvg(1.4))");
    expect(html).toContain("property('__zoom',d3.zoomIdentity).select('g').attr('transform',null)");
  });

  it('opens linked communities and supports single-document relation navigation', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('neighborCommunity=data.communities.find');
    expect(html).toContain('communityExpanded.add(neighborCommunity.id)');
    expect(html).toContain("selectAll('.focus-link,.link,.community-v3-detail-edge')");
    expect(html).toContain("selectAll('.focus-card,.node,.map-community,.community-v3-node')");
    expect(html).toContain('if(target)selectDocument(target)');
    expect(html).toContain('<span>Active relations</span>');
    expect(html).toContain('<span>Hidden by filters</span>');
    expect(html).toContain('addCommunityLegend()');
  });

  it('refits Provenance Focus instead of accumulating zoom on document navigation', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("if(view==='focus'){centerFocusContent();fitCurrentSvg()}");
    expect(html).not.toContain("if(view==='focus')zoomCurrentSvg(1.35)");
  });

  it('does not zoom Community Fit beyond normal scale and hides unrelated links', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('function fitCurrentSvg(maxZoom=Infinity)');
    expect(html).toContain("fitCurrentSvg(view==='community'?1.4:Infinity)");
    expect(html).toContain('requestAnimationFrame(()=>fitCurrentSvg(1.4))');
    expect(html).toContain("selected?e.from===selected.id||e.to===selected.id");
    expect(html).toContain("aggregateGroups.style('display','none')");
  });

  it('numbers Community nodes, exposes a scrollable document index and allows local dragging', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("attr('class','community-v3-node-number').text((_,index)=>index+1)");
    expect(html).toContain("stack.className='community-document-index-stack'");
    expect(html).toContain("panel.className='community-document-index'");
    expect(html).toContain('community-document-index-list');
    expect(html).toContain('.community-document-index-list{min-height:0;overflow:auto');
    expect(html).toContain('.community-document-index-stack{position:absolute');
    expect(html).toContain('background:color-mix(in srgb,var(--community-color,var(--line)) 20%,var(--panel))');
    expect(html).toContain('background:color-mix(in srgb,var(--community-color,var(--line)) 24%,var(--panel))');
    expect(html).toContain("communities.filter(community=>communityExpanded.has(community.id))");
    expect(html).toContain("nodeGroups.call(d3.drag()");
    expect(html).toContain("subject((_,node)=>({...local.get(node.id)}))");
    expect(html).toContain("limit=Math.max(12,radius-18)");
    expect(html).toContain("scale=Math.min(1,limit/distance)");
    expect(html).toContain("local.set(node.id,point)");
    expect(html).toContain('renderCommunityDocumentIndexes(shown,nodeById)');
  });

  it('shows complete truncated brick names in a clickable Focus index', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('function renderFocusNameIndex()');
    expect(html).toContain('node.title.length>24');
    expect(html).toContain("panel.className='focus-name-index'");
    expect(html).toContain('renderFocusNameIndex()');
    expect(html).toContain('.focus-name-index{position:absolute');
    expect(html).toContain("data-doc=\"'+esc(node.id)");
  });

  it('reflects Foundation and other active filters in all graph counters', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain('function updateCommunityFilterCounts(nodes)');
    expect(html).toContain("counter.textContent=String(count)");
    expect(html).toContain("summary.textContent=visibleCommunities.length+' communities · '+current.nodes.length+' documents · '+current.edges.length+' relations'");
    expect(html).toContain("text(members.length+' docs')");
    expect(html).toContain("text(c=>visibleCounts.get(c.id)+' pages')");
  });

  it('uses aggregate Map links without drawing invalid document-level overlays', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("selectAll('.map-community-link').classed('is-highlighted'");
    expect(html).not.toContain("attr('class','selection-chain')");
    expect(html).not.toContain("attr('class','selection-chain-link')");
  });

  it('keeps the selected Map document visible and labels it by name', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("selectedMember=members.find(n=>n.id===selected?.id)");
    expect(html).toContain("displayed[23]=selectedMember");
    expect(html).toContain("attr('class','map-selected-document-label')");
    expect(html).toContain("text(n.title)");
    expect(html).toContain("if(['community','list','map'].includes(view))render()");
  });

  it('automatically fits Community when switching views with a bounded zoom', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("if(view==='community')communityZoom=d3.zoomIdentity");
    expect(html).toContain("render();if(view==='community')requestAnimationFrame(()=>fitCurrentSvg(1.4))");
    expect(html).toContain('Number.isFinite(maxZoom)');
  });

  it('preserves the selected document from Map to Community and refits each scope', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("if(nextView!==view){selectedCommunity=null;lockedRelation=null;focusHistory.length=0;resetCommunityViewState();if(nextView==='community'&&selected)openCommunityForDocument(selected.id)");
    expect(html).toContain("if(view==='map')mapViewBox=fitHighlightedMap()||mapViewBox");
    expect(html).toContain("if(view==='community')fitCurrentSvgIfNeeded(1.4)");
    expect(html).toContain("function fitHighlightedMap()");
    expect(html).toContain("function fitCurrentSvgIfNeeded(maxZoom=1.4)");
    expect(html).toContain("content=root.getBoundingClientRect()");
    expect(html).toContain("if(!outside)return null");
    expect(html).toContain("function visibleRootBounds(svg,root)");
    expect(html).toContain("svg.getScreenCTM()?.inverse()");
    expect(html).not.toContain("root.removeAttribute('transform')");
    expect(html).toContain("communityPositions.set(community.id,position);return position");
    expect(html).not.toContain("communityExpanded.add(id);communityZoom=d3.zoomIdentity");
    expect(html).toContain("selected=null;selectedCommunity=id;if(view==='community')");
    expect(html).toContain("applyCommunityHighlight();if(view==='community')fitCurrentSvgIfNeeded(1.4)");
    expect(html).toContain("view=nextView;document.querySelectorAll('[data-view]')");
  });

  it('keeps user bubble positions while checking Fit after every document navigation', () => {
    const html = renderWikiGraphV2();

    expect(html).toContain("if(view==='community')fitCurrentSvgIfNeeded(1.4)");
    expect(html).not.toContain('previousCommunityIds=');
    expect(html).not.toContain('if(addedCommunity)');
  });

  it('runtime workflow graph reuses the shared D3 force socle instead of forking it', async () => {
    const runtimeSource = await runtimeGraphSource();
    const forceSource = await graphForceSource();

    expect(runtimeSource).toContain("import { graphForceScript } from '../../graph/core/graphForce.ts';");
    expect(runtimeSource).toContain('${graphForceScript()}');
    expect(runtimeSource).toContain('computeRuntimeWorkflowLayeredLayout(nodes,relations)');
    expect(runtimeSource).not.toContain('computeRadialForceLayout(');
    expect(runtimeSource).toContain('renderForceLinks(linkLayer,relations,nodes,');
    expect(runtimeSource).toContain('createForceNode(nodeLayer,node,');
    expect(runtimeSource).not.toContain('d3.forceSimulation');
    expect(forceSource).toContain('d3.forceSimulation(nodes)');
  });
});

describe('serve command palette', () => {
  it('locks background scroll and preserves keyboard navigation', async () => {
    const source = await serveSource();

    expect(source).toContain("document.body.style.overflow = 'hidden';");
    expect(source).toContain('document.body.style.overflow = previousOverflow;');
    expect(source).toContain('input.focus({ preventScroll: true });');
    expect(source).not.toContain("backdrop.addEventListener('wheel'");
    expect(source).toContain('function moveSelection(delta)');
    expect(source).toContain('function openSelected()');
  });

  it('keeps sidebar file paths available to the palette', async () => {
    const source = await serveSource();

    expect(source).toContain('data-side-path="${safePath}"');
    expect(source).toContain("document.querySelectorAll('[data-side-path]')");
  });

  it('serves markdown pages without browser cache so sidebar changes are fresh', async () => {
    const source = `${await serveSource()}\n${await wikiRoutesSource()}`;

    expect(source).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate'");
    expect(source).toContain('const html = await serveMd(rootDir, absolute, urlPath);');
    expect(source).toContain('await deps.sendGzippedHtml(req, res, html);');
    expect(source).not.toContain('async function navigationEtag(rootDir: string)');
    expect(source).not.toContain('function pageEtag(');
    expect(source).not.toContain('function requestHasEtag(');
  });

  it('keeps wiki editor actions sticky and shows file freshness', async () => {
    const source = await serveSource();

    expect(source).toContain('.edit-form .hero {');
    expect(source).toContain('position: sticky;');
    expect(source).toContain('.edit-file-state');
    expect(source).toContain('function fileStateLabel');
    expect(source).toContain("label: `${isNew ? 'new' : 'updated'} ${relativeTimeLabel(updatedAt)}`");
    expect(source).toContain('<span class="edit-path-label"><span>${escapeHtml(cleanRelativePath)}</span>${fileStateHtml}</span>');
  });
});

describe('serve deliverables ui', () => {
  it('labels deliverables by production type and avoids stale delete redirects', async () => {
    const source = await serveSource();

    expect(source).toContain("if (base.endsWith('.export.polished')) return 'polish';");
    expect(source).toContain("if (base.endsWith('.export')) return 'export';");
    expect(source).toContain("return 'build';");
    expect(source).toContain('data-deliverable-kind="${deliverableKind(file)}"');
    expect(source).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate'");
    expect(source).toContain(
      "return collection === 'templates' || collection === 'build-context';",
    );
    expect(source).toContain("segment.startsWith('.tmp.') || segment.startsWith('.changes.')");
    expect(source).toContain('depth === 0 && isCreatableCollection(node.name)');
    expect(source).not.toContain("node.name !== 'deliverables'");
    expect(source).not.toContain("cleanRelativePath !== 'deliverables'");
    expect(source).toContain('class="delete-confirm"');
    expect(source).toContain('delete-confirm-panel');
    expect(source).not.toContain("confirm('Delete this file?')");
  });
});

describe('serve missing feature endpoints', () => {
  it('exposes template rename and llm config controls', async () => {
    const source = await serveSource();
    const configSource = await configRoutesSource();
    const chatSource = await chatRoutesSource();
    const wikiSource = await wikiRoutesSource();

    expect(source).toContain('function renameHref(relativePath: string)');
    expect(wikiSource).toContain("urlPath.startsWith('/rename/')");
    expect(source).toContain('async function renameTemplate()');
    expect(configSource).toContain("urlPath !== '/api/llm-config'");
    expect(chatSource).toContain("req.headers['x-llm-wiki-llm-base-url']");
  });

  it('explains pending raw sources in the dashboard', async () => {
    const source = await serveSource();

    expect(source).toContain('Sources in raw/untracked');
  });
});

describe('serve chat proxy', () => {
  it('serves the shell for a top-level root navigation and leaves iframe root to wiki routes', async () => {
    const source = await chatRoutesSource();

    expect(source).toContain("req.headers['sec-fetch-dest']");
    expect(source).toContain("headerString(req.headers['sec-fetch-dest']) === 'document'");
    expect(source).toContain("urlPath !== '/chat' && urlPath !== '/chat/connectors' && !isRootShell");
  });

  it('reports unreachable LLM upstreams as a gateway error with Docker guidance', async () => {
    const source = `${await serveSource()}\n${await chatRoutesSource()}`;

    expect(source).toContain('function upstreamFetchFailureMessage');
    expect(source).toContain("sendJson(res, 502");
    expect(source).toContain('retryNetwork?: boolean');
    expect(source).toContain('setTimeout(resolve, 250)');
    expect(source).toContain('Upstream unreachable (${target}): ${detail}');
    expect(source).toContain('retryNetwork: true');
    expect(source).toContain('use the container network hostname, not 127.0.0.1');
    expect(source).toContain('process.env.WIKI_MCP_HTTP_PORT ?? process.env.WIKI_MCP_PORT');
    expect(source).toContain('try {');
    expect(source).toContain('const { done, value } = await reader.read();');
    expect(source).toContain('function chatProxyErrorStatus');
    expect(source).toContain("message === 'INVALID_LLM_BASE_URL' ? 400 : 502");
  });
});

describe('serve config reload', () => {
  it('watches the config directory and mutates the live config object', async () => {
    const source = await serveSource();

    expect(source).toContain('export function watchConfigReload');
    expect(source).toContain('watch(path.dirname(config.configPath)');
    expect(source).toContain('if (filename && filename.toString() !== configFileName) return;');
    expect(source).toContain('}, 300);');
    expect(source).toContain('Object.assign(config, fresh);');
    expect(source).toContain('configWatcher?.close();');
  });

  it('proxies config profile switching through the manager runtime and mirrors returned config', async () => {
    const source = await serveSource();
    const configSource = await configRoutesSource();

    expect(configSource).toContain("urlPath === '/api/config/profiles'");
    expect(configSource).toContain("urlPath === '/api/config/use'");
    expect(configSource).toContain("deps.runtimePathForWorkspace('/config/profiles')");
    expect(configSource).toContain("deps.runtimePathForWorkspace('/config/use')");
    expect(source).toContain('const resolveProfileConfigPath');
    expect(source).toContain('const mirrorRuntimeConfig = async');
    expect(source).toContain('process.env.WIKI_CONFIG_PATH = fileName;');
    expect(source).toContain('fresh = await loadConfig(rootDir);');
    expect(source).toContain('Object.assign(config, fresh);');
    expect(source).not.toContain('Object.assign(config, nextConfig);');
    expect(source).toContain('restartConfigWatcher();');
  });

  it('proxies limited runtime control without touching config mirroring', async () => {
    const routesSource = await runtimeRoutesSource();

    expect(routesSource).toContain("urlPath === '/api/runtime/control'");
    expect(routesSource).toContain("deps.runtimePathForWorkspace('/control')");
    expect(routesSource).toContain("req.method === 'GET' || req.method === 'POST'");
  });

  it('scopes runtime state, events and cancel proxies to the active workspace', async () => {
    const source = await serveSource();
    const eventsSource = await runtimeEventsSource();
    const routesSource = await runtimeRoutesSource();

    expect(source).toContain('const runtimePathForWorkspace = (pathname: string): string => {');
    expect(source).toContain('return `${pathname}${separator}workspace=${encodeURIComponent(wsName)}`;');
    expect(routesSource).toContain("deps.runtimePathForWorkspace('/state')");
    expect(routesSource).toContain("deps.runtimePathForWorkspace('/events/stream')");
    expect(routesSource).toContain("deps.runtimePathForWorkspace('/cancel')");
    expect(routesSource).toContain("urlPath === '/api/runtime/reset'");
    expect(routesSource).toContain("deps.runtimePathForWorkspace('/kill')");
    expect(routesSource).toContain("'&' : '?'}purge=true");
    expect(routesSource).toContain("await proxyRuntimeJson(req, res, '/run', deps.proxyDeps, wsName ? { workspace: wsName } : undefined);");
    expect(routesSource).toContain("await proxyRuntimeJson(req, res, '/turn', deps.proxyDeps, wsName ? { workspace: wsName } : undefined);");
    expect(eventsSource).toContain('export async function proxyRuntimeEvents');
    expect(eventsSource).toContain("accept: 'text/event-stream'");
    expect(eventsSource).toContain("res.writeHead(200, {");
    expect(eventsSource).toContain("'Content-Type': 'text/event-stream'");
    expect(eventsSource).toContain("'Cache-Control': 'no-cache'");
  });

  it('uses the coordinated release version for serve MCP handshakes', async () => {
    const source = await serveSource();
    const uploadSource = await uploadRoutesSource();

    expect(source).toMatch(/const LLM_WIKI_VERSION = '[^']+';/);
    expect(source).toContain('version: LLM_WIKI_VERSION');
    expect(uploadSource).toContain("clientInfo: { name: 'llm-wiki-serve', version }");
  });
});
