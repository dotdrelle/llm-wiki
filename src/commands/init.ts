import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';
import { HistoryService } from '../services/historyService.ts';

export default async function initCmd(config: AppConfig, options: { force?: boolean }) {
  const workspace = new WorkspaceService(config);
  await workspace.initWorkspace({ force: options.force });
  const history = await new HistoryService(workspace.paths.rootDir, config.history).initialize({
    baseline: true,
  });
  if (history.warnings.length > 0) {
    console.warn(`History disabled for this workspace: ${history.warnings.join(', ')}`);
  }
  console.log(`Initialized local wiki workspace in ${workspace.paths.rootDir}`);
}
