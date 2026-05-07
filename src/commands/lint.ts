import type { AppConfig } from '../types.ts';
import { LLMService } from '../services/llmService.ts';
import { LintService } from '../services/lintService.ts';
import { WorkspaceService } from '../services/workspaceService.ts';

export default async function lintCmd(
  config: AppConfig,
  options: { withLlm?: boolean; json?: boolean },
) {
  const workspace = new WorkspaceService(config);
  const llm = new LLMService(config);
  const service = new LintService(workspace, llm, config);
  const report = await service.run({ withLlm: options.withLlm });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Dead links:', report.deadLinks.length);
  for (const deadLink of report.deadLinks) {
    console.log(`  - [[${deadLink.link}]] in ${deadLink.file}`);
  }

  console.log('Orphan pages:', report.orphanPages.length);
  for (const orphanPage of report.orphanPages) {
    console.log(`  - ${orphanPage}`);
  }

  console.log('Missing sources:', report.missingSources.length);
  for (const missingSource of report.missingSources) {
    console.log(`  - ${missingSource.citation} cited in ${missingSource.file}`);
  }

  console.log('Stale deliverables:', report.staleDeliverables.length);
  for (const deliverable of report.staleDeliverables) {
    console.log(`  - ${deliverable}`);
  }

  if (report.semantic) {
    console.log('Semantic contradictions:', report.semantic.contradictions.length);
    console.log('Missing concepts:', report.semantic.missingConcepts.length);
    console.log('Shallow pages:', report.semantic.shallowPages.length);
  }
}
