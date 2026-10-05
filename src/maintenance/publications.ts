import path from 'node:path';
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { hashText } from '../utils/hash.ts';
import { safeWriteFile } from '../utils/fs.ts';
import { resolveInside } from '../utils/path.ts';
import { outputSnapshot } from './outputGuard.ts';
import { EXPORT_PROMPT_VERSION } from '../prompts/exportPrompt.ts';

export interface Publication {
  schemaVersion: 1; id: string; source: string; sourceHash: string;
  evidenceBuildId?: string; operation: 'export' | 'polish';
  parameters: Record<string, unknown>; output: string; outputHash: string;
  status: 'prepared' | 'verified'; createdAt: string;
}
/**
 * What decides how an export or a polish is written, besides its source: the
 * prompt version, the session language and the operation. The model is left
 * out on purpose — a profile switch must not stale every export at once.
 */
export function transformSignature(operation: 'export' | 'polish', language: string): string {
  return hashText(JSON.stringify({ prompt: EXPORT_PROMPT_VERSION, language: String(language ?? ''), operation }));
}
export async function preparePublication(root: string, data: Omit<Publication, 'schemaVersion' | 'id' | 'createdAt' | 'status'>): Promise<Publication> {
  const id = hashText(JSON.stringify(data));
  const record: Publication = { ...data, schemaVersion: 1, id, status: 'prepared', createdAt: new Date().toISOString() };
  await safeWriteFile(path.join(root, '.wiki', 'publications', id + '.json'), JSON.stringify(record));
  return record;
}
export async function finishPublication(root: string, record: Publication): Promise<void> {
  const content = await outputSnapshot(resolveInside(root, record.output));
  if (content === null || hashText(content) !== record.outputHash) throw new Error('publication_readback_failed');
  await safeWriteFile(path.join(root, '.wiki', 'publications', record.id + '.json'), JSON.stringify({ ...record, status: 'verified' }));
}
export async function publicationState(root: string, { language }: { language?: string } = {}) {
  const files = await fg('*.json', { cwd: path.join(root, '.wiki', 'publications'), onlyFiles: true });
  const records = [];
  for (const file of files.sort()) {
    const record = JSON.parse(await readFile(path.join(root, '.wiki', 'publications', file), 'utf8')) as Publication;
    if (record.schemaVersion !== 1) throw new Error('publication_schema_unsupported');
    const source = await outputSnapshot(resolveInside(root, record.source));
    const output = await outputSnapshot(resolveInside(root, record.output));
    const verified = output !== null && hashText(output) === record.outputHash;
    const sourceFresh = source !== null && hashText(source) === record.sourceHash;
    // A receipt without a transform (written before it was recorded) is not
    // flagged: nothing says its settings differ.
    const recorded = typeof record.parameters?.transform === 'string' ? record.parameters.transform : null;
    const settingsFresh = recorded === null || language === undefined || recorded === transformSignature(record.operation, language);
    records.push({ ...record, recovered: record.status === 'prepared' && verified,
      fresh: verified && sourceFresh && settingsFresh,
      reason: !verified ? 'output_missing_or_modified' : !sourceFresh ? 'source_changed' : !settingsFresh ? 'settings_changed' : null });
  }
  // The most recent receipt for each output is authoritative.
  return [...new Map(records.sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map((r) => [r.output, r])).values()];
}
