// The Donna launches a wiki page can trigger from the shell: Build (template),
// Export/polish (deliverable) and Reformat (ingested page). Each validates the
// path and fills the composer with the exact skill turn — the page never calls
// the runtime. Extracted from wikiPanelScript.ts, whose size ceiling this block
// had exhausted; it runs in the chat page's script scope, so showChatView(),
// agentMode, updateAgentModeUI(), sendMessage(), validPageContext(),
// addPageContext() and decodeWikiPath() are the globals defined there.
export const WIKI_AGENT_LAUNCH_SCRIPT = `
function handleWikiAgentLaunch(data) {
  if (data.type === 'llmwiki:buildTemplate') {
    // "Build" clicked on a template page in the central wiki frame. The launch
    // runs through Donna, so route it as a /wiki-build skill invocation: switch
    // to the chat, fill the composer with the exact template path and submit.
    const templatePath = decodeWikiPath(data.path).replace(/^\\//, '');
    if (!/^templates\\/.+\\.md$/.test(templatePath)) {
      if (typeof notify === 'function') notify('Cannot build: not a template file');
      return true;
    }
    showChatView();
    const input = $('chat-input');
    if (!input) return true;
    input.value = '/wiki-build ' + templatePath;
    sendMessage();
    return true;
  }
  if (data.type === 'llmwiki:deliver') {
    // "Export / polish" clicked on a deliverable page in the central wiki frame.
    // Same Donna-routed launch as Build-template: switch to the chat, fill the
    // composer with the exact deliverable path and submit as a /deliver turn.
    const deliverablePath = decodeWikiPath(data.path).replace(/^\\//, '');
    if (!/^deliverables\\/.+\\.md$/.test(deliverablePath)) {
      if (typeof notify === 'function') notify('Cannot deliver: not a deliverable file');
      return true;
    }
    showChatView();
    const input = $('chat-input');
    if (!input) return true;
    input.value = '/deliver ' + deliverablePath;
    sendMessage();
    return true;
  }
  if (data.type === 'llmwiki:reformat') {
    // Agent mode + a plain conversational request in the session language,
    // never a raw English instruction body.
    const pagePath = decodeWikiPath(data.path).replace(/^\\//, '');
    if (!/^wiki\\/(concepts|sources|answers)\\/.+\\.md$/.test(pagePath)) {
      if (typeof notify === 'function') notify('Cannot reformat: not an ingested wiki page');
      return true;
    }
    const contextPath = validPageContext(data.path);
    if (contextPath) addPageContext(contextPath);
    showChatView();
    const input = $('chat-input');
    if (!input) return true;
    if (!agentMode) { agentMode = true; updateAgentModeUI(); }
    const french = window.__WIKI_CONFIG__?.language === 'fr';
    input.value = french
      ? 'Reformate la page ' + pagePath + ' sur place, sans la déplacer ni la re-filer : mets le corps en Markdown propre (titres, listes et tableaux bien formés) en conservant tous les faits et sections ; répare les liens et citations mal formés (note « Broken links » pour les irréparables) ; complète le frontmatter OKF (type, title, clés manquantes) ; écris le résultat avec wiki_write_page et confirm=true.'
      : 'Reformat the page ' + pagePath + ' in place, without moving or re-filing it: rewrite the body as clean Markdown (headings, lists and tables) while preserving every fact and section; fix malformed links and citations ("Broken links" note for the unresolvable ones); complete the OKF frontmatter (type, title, missing keys); write the result back with wiki_write_page and confirm=true.';
    sendMessage();
    return true;
  }
  return false;
}
`;
