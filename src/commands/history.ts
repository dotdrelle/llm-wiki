import { HistoryService } from '../services/historyService.ts';
import type { AppConfig } from '../types.ts';

export default async function historyCmd(
  config: AppConfig,
  options: { file?: string; limit?: number; json?: boolean },
): Promise<void> {
  const history = new HistoryService(config.wikiRoot, config.history);
  const entries = await history.log({ file: options.file, limit: options.limit });
  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log('No workspace history available.');
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.shortSha} ${entry.date} ${entry.subject}`);
  }
}
