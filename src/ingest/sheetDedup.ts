import { createHash } from 'node:crypto';

export type SheetIndexEntry = {
  path: string;
  title: string;
  description?: string;
  inputHash?: string;
  contentHash?: string;
  excerpt?: string;
};

export function sheetInputHash(sourcePath: string, startLine: number, endLine: number, body: string, signature: string): string {
  return createHash('sha256')
    .update(`${sourcePath}\0${startLine}-${endLine}\0${signature}\0${body}`, 'utf8')
    .digest('hex');
}

export function sheetContentHash(body: string, signature: string): string {
  return createHash('sha256').update(`${signature}\0${body}`, 'utf8').digest('hex');
}

export function exactSheetDuplicate(contentHash: string, index: Iterable<SheetIndexEntry>): SheetIndexEntry | null {
  if (!contentHash) return null;
  return [...index].find((entry) => entry.contentHash === contentHash) ?? null;
}

export function closeSheetCandidates(title: string, description: string, index: Iterable<SheetIndexEntry>, max = 5): SheetIndexEntry[] {
  const tokens = new Set(`${title} ${description}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  if (tokens.size === 0) return [];
  return [...index]
    .map((entry) => {
      const candidate = new Set(`${entry.title} ${entry.description ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
      const overlap = [...tokens].filter((token) => candidate.has(token)).length;
      return { entry, overlap };
    })
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.entry.path.localeCompare(b.entry.path))
    .slice(0, max)
    .map((row) => row.entry);
}
