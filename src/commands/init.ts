import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function initCmd(config: AppConfig, options: { force?: boolean }) {
  const workspace = new WorkspaceService(config);
  await workspace.initWorkspace({ force: options.force });
  console.log(`Initialized local wiki workspace in ${workspace.paths.rootDir}`);
}
