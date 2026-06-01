import type { AppConfig } from '../types.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function addSkillCmd(config: AppConfig, source: string) {
  const workspace = new WorkspaceService(config);
  const result = await workspace.addSkill(source);
  const label = [result.name, result.version].filter(Boolean).join('@') || source;
  console.log(`Skill installed: ${label}`);
  console.log(`Backup: ${result.backupDir}`);
  console.log(`Installed: ${result.installed.join(', ')}`);
}
