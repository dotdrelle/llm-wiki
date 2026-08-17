import { HistoryService } from '../services/historyService.ts';
import type { AppConfig } from '../types.ts';

export default async function releaseCmd(
  config: AppConfig,
  options: { label?: string; list?: boolean },
): Promise<void> {
  const history = new HistoryService(config.wikiRoot, config.history);
  if (options.list) {
    const releases = await history.listReleases();
    if (releases.length === 0) {
      console.log('No releases yet.');
      return;
    }
    for (const release of releases) {
      console.log(`${release.name} ${release.sha.slice(0, 12)} ${release.date} ${release.subject}`);
    }
    return;
  }
  const release = await history.createRelease(options.label);
  console.log(`Released workspace state as ${release.name} (${release.sha.slice(0, 12)})`);
}
