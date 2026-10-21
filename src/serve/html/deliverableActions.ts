import { escapeHtml } from '../../utils/html.ts';
import { isExportArtifactPath } from '../../utils/exportArtifact.ts';

const escapeAttr = (value: string): string => escapeHtml(value).replace(/"/g, '&quot;');

/**
 * The actions of a deliverable page, in the page's action bar.
 *
 * "Export / polish" is hidden by default: only the chat shell can deliver (the
 * export/polish runs through Donna), so WIKI_LAYOUT_SCRIPT reveals it inside
 * the shell's central iframe, exactly like the template "Build" button. It is
 * not offered on an export/polished artifact: re-running it there re-exported
 * the export and spawned a second version — the action belongs on the SOURCE
 * deliverable.
 *
 * "Provenance" opens the /provenance page of the deliverable (template →
 * sections → pivots → fiches → archive fragments). It is read-only, so it is a
 * plain link visible everywhere and needs no Donna turn; it is offered on
 * export artifacts too, which the page resolves to their source deliverable.
 */
export function deliverableActions(relativePath: string, exportIcon: string): string {
  if (!relativePath.startsWith('deliverables/') || !relativePath.endsWith('.md')) return '';
  const deliver = isExportArtifactPath(relativePath)
    ? ''
    : `<button class="action-button action-donna" type="button" data-deliver="${escapeAttr(relativePath)}" hidden title="Export / polish" aria-label="Export / polish">${exportIcon}</button>`;
  const provenance = `<a class="action-link" href="${escapeAttr(`/provenance?id=${encodeURIComponent(relativePath)}`)}" title="Show where this deliverable's evidence comes from">Provenance</a>`;
  return deliver + provenance;
}

/**
 * "Reload" on a deliverable or template page: a build or an export rewrites a
 * deliverable, Donna rewrites a template, while the reader has it open, and
 * nothing else re-renders the page. Placed at the right end of the action bar
 * (before the shell's Close), visible everywhere.
 */
export function deliverableReloadButton(relativePath: string): string {
  const kind = relativePath.startsWith('deliverables/') ? 'deliverable' : relativePath.startsWith('templates/') ? 'template' : '';
  if (!kind || !relativePath.endsWith('.md')) return '';
  return `<button class="action-button action-reload" type="button" onclick="location.reload()" title="Reload this ${kind}" aria-label="Reload this ${kind}">`
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>';
}
