import { describe, expect, it } from 'vitest';
import { createWritePreviewPayload } from '../src/services/mcpServer.ts';

describe('MCP write guards', () => {
  it('returns a confirmation-gated preview without embedding full content', () => {
    const payload = createWritePreviewPayload({
      target: 'wiki/example.md',
      before: 'title\nold line\nstable',
      after: 'title\nnew line\nstable',
      confirmed: false,
      dryRun: false,
      written: false,
    });

    expect(payload.written).toBe(false);
    expect(payload.requiresConfirmation).toBe(true);
    expect(payload.changed).toBe(true);
    expect(payload.preview).toContain('- old line');
    expect(payload.preview).toContain('+ new line');
    expect(payload.beforeSha256).toHaveLength(64);
    expect(payload.afterSha256).toHaveLength(64);
    expect(payload).not.toHaveProperty('before');
    expect(payload).not.toHaveProperty('after');
  });

  it('marks confirmed writes as not requiring another confirmation', () => {
    const payload = createWritePreviewPayload({
      target: '.wiki/profile.md',
      before: 'old',
      after: 'new',
      confirmed: true,
      dryRun: false,
      written: true,
    });

    expect(payload.written).toBe(true);
    expect(payload.requiresConfirmation).toBe(false);
    expect(payload.confirmed).toBe(true);
  });
});
