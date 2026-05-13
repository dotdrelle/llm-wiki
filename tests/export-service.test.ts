import { describe, expect, it } from 'vitest';
import { exportOutputPath } from '../src/services/exportService.ts';

describe('export service', () => {
  it('does not append export twice to already exported deliverables', () => {
    expect(exportOutputPath('deliverables/brief.md')).toBe('deliverables/brief.export.md');
    expect(exportOutputPath('deliverables/brief.export.md')).toBe(
      'deliverables/brief.export.md',
    );
  });

  it('polishes exported deliverables without duplicating suffixes', () => {
    expect(exportOutputPath('deliverables/brief.md', { polish: true })).toBe(
      'deliverables/brief.export.md',
    );
    expect(exportOutputPath('deliverables/brief.export.md', { polish: true })).toBe(
      'deliverables/brief.export.polished.md',
    );
    expect(
      exportOutputPath('deliverables/brief.export.polished.md', { polish: true }),
    ).toBe('deliverables/brief.export.polished.md');
  });
});
