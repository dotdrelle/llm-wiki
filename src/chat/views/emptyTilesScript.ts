/**
 * The empty chat's entry points (Workspace status, Explore the wiki,
 * Workspace profile). Each tile is a Donna turn. Extracted from chatHtml.ts.
 */
export const EMPTY_TILES_SCRIPT = `
// The empty-chat entry points. Each one is a Donna turn — the tile only picks
// the mode and the question; the answer is hers. The composed questions are
// hidden (interface-written, never memory evidence) except /status, which is
// the public command and teaches it.
function submitComposedTurn(text,{label,forceChat=false,agent=false}={}) {
  showChatView();
  const input=$('chat-input');
  if(!input||isStreaming) return;
  if(agent&&!agentMode) { agentMode=true; updateAgentModeUI(); }
  input.value=text;
  input.dataset.displayText=label||text;
  if(forceChat) input.dataset.forceChat='1';
  input.dataset.hideQuestion='1';
  sendMessage();
}
// The runtime answers a bare /status with the workspace snapshot (wiki,
// sources, deliverables, services, connectors) plus the run state, for Donna
// to summarize.
function startWorkspaceStatus() {
  showChatView();
  const input=$('chat-input');
  if(!input||isStreaming) return;
  input.value='/status';
  input.dataset.forceChat='1';
  sendMessage();
}
function startWikiTour() {
  submitComposedTurn('Give me a guided tour of this wiki: the main topics and concept families it covers, the documents it was built from, and three pages worth opening first, each with its link. If the wiki is still empty, say so plainly and tell me how to fill it.',{label:'Explore the wiki',forceChat:true});
}
// A profile edit is a write, so agent mode — and Donna writes nothing before
// the user has answered and confirmed the exact text.
function startProfileInterview() {
  submitComposedTurn('Help me complete the workspace profile. Start from the current profile you were given: say in two short lines what it already covers, then ask me at most three short questions about what is missing (the project and its context, who reads the deliverables, the preferred tone and answer language, who to notify). Write nothing until I have answered and confirmed the exact text you propose to save.',{label:'Workspace profile',agent:true});
}
`;
