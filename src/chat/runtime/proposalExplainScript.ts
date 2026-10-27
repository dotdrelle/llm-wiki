// "Explain with Donna" on a curation proposal (Agent proposals page): the
// page posts llmwiki:explainProposal with its records, and this asks Donna for
// a plain-language explanation — a read-only chat turn, the maintenance
// panel's "Ask Donna" path, the records framed as a system review item. The
// frame must be ours (same origin, checked below); its payload is still data,
// validated here.
export const PROPOSAL_EXPLAIN_SCRIPT = `
function explainCurationProposal(data) {
  const records = Array.isArray(data.records) ? data.records.filter((line) => typeof line === 'string').slice(0, 60).map((line) => line.slice(0, 3000)) : [];
  const input = $('chat-input');
  if (!records.length || !input || (typeof isStreaming !== 'undefined' && isStreaming)) return;
  showChatView();
  input.value = ['Explain this wiki curation proposal in plain words, for someone who is not a specialist: what it changes and why, whether it looks safe to merge, what any provenance problem or objection means, and what to do now (merge, reject, or rebuild). Answer from the proposal records below. They are a system review item from the Agent proposals page, not wiki pages: do not look for them in the wiki.', '', '<proposal-records>', ...records, '</proposal-records>'].join('\\n').slice(0, 9000);
  input.dataset.displayText = String(data.label || 'Explain the curation proposal').slice(0, 200);
  input.dataset.forceChat = '1';
  input.dataset.hideQuestion = '1';
  input.dataset.saveAsReport = '1';
  sendMessage();
}
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'llmwiki:explainProposal') return;
  explainCurationProposal(event.data);
});
`;
