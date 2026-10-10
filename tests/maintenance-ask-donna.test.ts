import { describe, expect, it } from 'vitest';
import { MAINTENANCE_PANEL_SCRIPT } from '../src/chat/runtime/maintenancePanelScript.ts';

// "Ask Donna" used to pre-fill the composer with raw facts and "My question: ",
// leaving the reader to write the question; with only "cycle failed" in those
// facts, Donna searched the wiki and answered that she did not know.
describe('Ask Donna from the Maintenance panel', () => {
  const askDonna = MAINTENANCE_PANEL_SCRIPT.slice(
    MAINTENANCE_PANEL_SCRIPT.indexOf('function askDonna('),
    MAINTENANCE_PANEL_SCRIPT.indexOf('sendMessage();}', MAINTENANCE_PANEL_SCRIPT.indexOf('function askDonna(')),
  );

  it('sends the question in one click, the facts hidden behind a short label', () => {
    expect(askDonna).toContain("input.dataset.hideQuestion='1'");
    expect(askDonna).toContain('input.dataset.displayText=label');
    expect(askDonna).toContain('<maintenance-records>');
    expect(askDonna).toMatch(/not wiki pages: do not look for them in the wiki/);
    expect(MAINTENANCE_PANEL_SCRIPT).not.toContain('My question: ');
  });

  it('hands Donna each record with its error detail and the routine work around the cycle', () => {
    expect(MAINTENANCE_PANEL_SCRIPT).toContain("(detail: '");
    expect(MAINTENANCE_PANEL_SCRIPT).toMatch(/Math\.abs\(Date\.parse\(e\.at\)-Date\.parse\(c\.at\)\)<=15\*60_000/);
  });
});

describe('Maintenance thread rows', () => {
  const start = MAINTENANCE_PANEL_SCRIPT.indexOf('function maintenanceActionSummary(');
  const end = MAINTENANCE_PANEL_SCRIPT.indexOf('function maintenanceDuration(');
  const rows = new Function(`${MAINTENANCE_PANEL_SCRIPT.slice(start, end)}\nreturn maintenanceActivityRows;`)() as (events: unknown[]) => Array<{ seq: number; kind: string }>;

  it('shows a finished action once, with its outcome, not its PENDING start', () => {
    // juno: outcome records carry no target, so every start stayed PENDING
    // and all the outcomes of a cycle collapsed into a single row.
    const c = 'cycle-1';
    const out = rows([
      { seq: 1, cycleId: c, kind: 'action_started', action: 'build', target: 'templates/a.md', message: 'Maintenance: Rebuild a.md because the wiki content changed' },
      { seq: 2, cycleId: c, kind: 'action_started', action: 'build', target: 'templates/b.md', message: 'Maintenance: Rebuild b.md because the wiki content changed' },
      { seq: 3, cycleId: c, kind: 'action_done', action: 'build', message: 'Maintenance: Done: Rebuild a.md because the wiki content changed' },
      { seq: 4, cycleId: c, kind: 'failure', action: 'build', message: 'Maintenance: Rebuild b.md because the wiki content changed — not done: boom' },
    ]);
    expect(out.map((e) => [e.seq, e.kind])).toEqual([[4, 'failure'], [3, 'action_done']]);
  });

  it('carries how long a finished action took, from its own start', () => {
    const c = 'cycle-1';
    const [done] = rows([
      { seq: 1, cycleId: c, at: '2026-10-10T11:24:13Z', kind: 'action_started', action: 'build', target: 't', message: 'Maintenance: Rebuild f.md' },
      { seq: 2, cycleId: c, at: '2026-10-10T11:30:55Z', kind: 'action_done', action: 'build', target: 't', message: 'Maintenance: Done: Rebuild f.md' },
    ]) as Array<{ durationMs?: number }>;
    expect(done.durationMs).toBe(402_000);
    const running = rows([{ seq: 1, cycleId: c, at: '2026-10-10T11:24:13Z', kind: 'action_started', action: 'build', message: 'Maintenance: Rebuild f.md' }]) as Array<{ durationMs?: number }>;
    expect(running[0].durationMs).toBeUndefined();
  });
});
