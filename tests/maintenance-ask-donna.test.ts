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
