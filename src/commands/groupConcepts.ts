import type { AppConfig } from '../types.ts';
import {
  ConceptGroupingService,
  formatConceptGroupPlan,
} from '../services/conceptGroupingService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function groupConceptsCmd(
  config: AppConfig,
  options: { apply?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const service = new ConceptGroupingService(workspace);
  const plan = await service.plan();

  console.log(formatConceptGroupPlan(plan));

  if (!options.apply) {
    console.log('\nDry run only. Re-run with --apply to move files and update wiki links.');
    return;
  }

  await service.apply(plan);
  console.log(`\nApplied ${plan.moves.length} concept move(s).`);
}
