// The actions a wiki CONTENT page offers inside the chat shell's central
// iframe: report its navigation, then reveal the shell-only buttons (Close,
// + Context, Build, Export/polish, Reformat, Start a curation) and turn each
// click into the shell message that owns the launch. Standalone pages no-op:
// there is no chat to route to. Extracted from wikiLayoutScript.ts, whose size
// ceiling this block had exhausted.
export const PAGE_ACTIONS_SCRIPT = `
(function initEmbeddedPageActions() {
  if (window.self === window.top || document.documentElement.classList.contains('sidebar-panel')) return;
  window.parent.postMessage(
    { type: 'llmwiki:nav', path: window.location.pathname },
    window.location.origin,
  );
  // Close: only meaningful inside the shell's central frame. Revealed here
  // and turned into an llmwiki:close message the shell acts on — so the
  // control lives in this toolbar, not as an overlay pinned over it.
  const shellCloseBtn = document.querySelector('[data-shell-close]');
  if (shellCloseBtn) {
    shellCloseBtn.hidden = false;
    shellCloseBtn.addEventListener('click', () => {
      window.parent.postMessage({ type: 'llmwiki:close' }, window.location.origin);
    });
  }
  // "+ Context": only meaningful inside the chat shell, so the button
  // ships hidden and is revealed here. Clicking hands the page path to the
  // shell, which validates it and renders the context chip.
  const chatContextBtn = document.querySelector('[data-chat-context]');
  if (chatContextBtn) {
    chatContextBtn.hidden = false;
    chatContextBtn.addEventListener('click', () => {
      window.parent.postMessage(
        { type: 'llmwiki:addContext', path: chatContextBtn.getAttribute('data-chat-context') },
        window.location.origin,
      );
    });
  }
  // "Build": only meaningful inside the chat shell, where Donna owns the
  // launch. Reveal the button and hand the template path to the shell.
  const buildTemplateBtn = document.querySelector('[data-build-template]');
  if (buildTemplateBtn) {
    buildTemplateBtn.hidden = false;
    // Launching an agent consumes LLM budget and occupies the runtime: it goes
    // through the same confirmation as destructive actions.
    buildTemplateBtn.addEventListener('click', async () => {
      const path = buildTemplateBtn.getAttribute('data-build-template');
      if (!(await confirmAction({
        title: 'Build template',
        message: 'Run the build agent on this template?\\n' + path,
        confirmLabel: 'Build',
      }))) return;
      window.parent.postMessage(
        { type: 'llmwiki:buildTemplate', path },
        window.location.origin,
      );
    });
  }
  // "Export / polish" on a deliverable: same reveal-on-embed + confirmation +
  // Donna-routed launch as Build-template above. The deliverable path travels
  // with the message; the shell turns it into a /deliver skill turn.
  const deliverBtn = document.querySelector('[data-deliver]');
  if (deliverBtn) {
    deliverBtn.hidden = false;
    deliverBtn.addEventListener('click', async () => {
      const path = deliverBtn.getAttribute('data-deliver');
      if (!(await confirmAction({
        title: 'Export deliverable',
        message: 'Run the deliver agent to export or polish this deliverable?\\n' + path,
        confirmLabel: 'Export',
      }))) return;
      window.parent.postMessage(
        { type: 'llmwiki:deliver', path },
        window.location.origin,
      );
    });
  }
  // "Reformat" on an ingested wiki page: an LLM pass, run by Donna under
  // approval, that cleans the Markdown, checks the links and repairs the OKF
  // frontmatter without moving or renaming the page. Same reveal-on-embed +
  // confirmation + Donna-routed launch as the two buttons above.
  const reformatBtn = document.querySelector('[data-reformat-page]');
  if (reformatBtn) {
    reformatBtn.hidden = false;
    reformatBtn.addEventListener('click', async () => {
      const path = reformatBtn.getAttribute('data-reformat-page');
      if (!(await confirmAction({
        title: 'Reformat page',
        message: 'Run an LLM reformat pass on this page (clean Markdown, link check, OKF frontmatter)? You will review the diff before it is written.\\n' + path,
        confirmLabel: 'Reformat',
      }))) return;
      window.parent.postMessage(
        { type: 'llmwiki:reformat', path },
        window.location.origin,
      );
    });
  }
  // "Start a curation" on the Agent proposals page: an agent run (LLM budget,
  // worktree branch), so the same reveal-on-embed + confirmation + shell-routed
  // launch as the page actions above. The page only asks; the chat's own
  // curation entry point (startCuration) owns the objective and the mode.
  const curateRow = document.querySelector('[data-curate-row]');
  const curateLaunch = document.querySelector('[data-curate-launch]');
  if (curateRow && curateLaunch) {
    curateRow.hidden = false;
    curateLaunch.addEventListener('click', async () => {
      if (!(await confirmAction({
        title: 'Curate the wiki',
        message: 'Run the curation agent on this workspace? It reads the wiki and proposes corrections on a separate branch; nothing is written until you merge the proposal.',
        confirmLabel: 'Curate',
      }))) return;
      window.parent.postMessage({ type: 'llmwiki:curate' }, window.location.origin);
    });
  }
})();
`;
