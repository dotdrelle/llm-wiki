/**
 * Export artifacts — `<name>.export.md`, `<name>.export.polished.md`, and their
 * archived `<name>_v-YY.export(.polished).md` copies — are the OUTPUT of
 * `export`/`polish`, never a source of their own. Shared by the export refusal
 * (`exportArtifactTargetError`) and the graph's Provenance view, which both
 * need the deliverable an artifact was produced from.
 */
const EXPORT_ARTIFACT = /\.export(?:\.polished)?\.md$/i;

export function isExportArtifactPath(value: string): boolean {
  return EXPORT_ARTIFACT.test(String(value ?? '').replace(/\\/g, '/'));
}

/** The source deliverable of an export artifact, or `null` for any other path. */
export function exportArtifactSourcePath(value: string): string | null {
  const posix = String(value ?? '').replace(/\\/g, '/');
  if (!EXPORT_ARTIFACT.test(posix)) return null;
  return posix.replace(EXPORT_ARTIFACT, '.md').replace(/_v-\d+(\.md)$/i, '$1');
}
