import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard: scaffold skills seed every new workspace. Their tool references
// must always use the qualified `server__tool` call form — bare tool names
// in skill bodies teach the agent to emit unqualified tool calls (the
// `cme_status` vs `cme__cme_status` incident). Any new or edited scaffold
// skill that reintroduces a bare name must fail here.
//
// The known bare names mirror the tools exposed by the agent servers
// (agent-cme, agent-wiki-production, agent-wiki-documents,
// agent-mailer-api) plus the generic orchestration contract.
const KNOWN_BARE_TOOL_NAMES = [
  'cme_status', 'cme_setup', 'cme_sources_list', 'cme_source_add',
  'cme_source_remove', 'cme_export_run', 'cme_export_status', 'cme_export_cancel',
  'production_status', 'production_list_templates', 'production_start_job',
  'production_job_status', 'production_job_logs', 'production_cancel_job',
  'production_list_jobs',
  'documents_status', 'documents_convert_to_markdown',
  'mailer_send_email', 'mailer_status',
  'agent_describe', 'agent_plan', 'agent_execute', 'agent_status', 'agent_cancel',
];

const SKILLS_DIR = join(__dirname, '..', 'scaffold', 'workspace', '.wiki', 'skills');

describe('scaffold skills tool naming', () => {
  const skillFiles = readdirSync(SKILLS_DIR).filter((name) => name.endsWith('.md'));

  it('finds scaffold skills to check', () => {
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  for (const file of skillFiles) {
    it(`${file} references tools only in qualified server__tool form`, () => {
      const content = readFileSync(join(SKILLS_DIR, file), 'utf8');
      const offenders: string[] = [];
      for (const bare of KNOWN_BARE_TOOL_NAMES) {
        // Bare = not embedded in a wider identifier; the inner occurrence in
        // `cme__cme_status` is preceded by `_` and therefore does not match.
        const pattern = new RegExp(`(?<![\\w])${bare}(?![\\w])`);
        if (pattern.test(content)) offenders.push(bare);
      }
      expect(offenders, `Unqualified tool names in ${file}: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});
