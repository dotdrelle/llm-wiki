import { describe, expect, it } from 'vitest';
import { deliverableResponseSchema, ingestPlanSchema } from '../src/config/schema.ts';

describe('ingest plan schema', () => {
  it('normalizes common LLM operation aliases', () => {
    const plan = ingestPlanSchema.parse({
      log_message: 'ok',
      changes: [
        {
          action: 'CREATE_PAGE',
          file: 'wiki/concepts/test.md',
          markdown: '# Test',
        },
        {
          op: 'write_file',
          target: 'wiki/index.md',
          text: '# Wiki Index',
        },
        {
          operation: 'remove_page',
          filename: 'wiki/concepts/old.md',
        },
      ],
    });

    expect(plan.summary).toBe('ok');
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      'create',
      'update',
      'delete',
    ]);
    expect(plan.operations.map((operation) => operation.path)).toEqual([
      'wiki/concepts/test.md',
      'wiki/index.md',
      'wiki/concepts/old.md',
    ]);
  });

  it('defaults a missing operation type to update when content is present', () => {
    const plan = ingestPlanSchema.parse({
      operations: [
        {
          path: 'index.md',
          content: '# Wiki Index',
        },
      ],
    });

    expect(plan.operations[0]?.type).toBe('update');
  });

  it('rejects create and update operations without content', () => {
    expect(() =>
      ingestPlanSchema.parse({
        operations: [
          {
            type: 'create',
            path: 'wiki/sources/missing-content.md',
          },
        ],
      }),
    ).toThrow(/requires content/i);
  });
});

describe('deliverable response schema', () => {
  it('normalizes common replacement aliases', () => {
    const response = deliverableResponseSchema.parse({
      items: [
        {
          slot_id: 'instruction-1',
          markdown: 'Documented summary.',
        },
      ],
    });

    expect(response.replacements).toEqual([
      {
        id: 'instruction-1',
        content: 'Documented summary.',
      },
    ]);
  });

  it('normalizes object maps of slot ids to content', () => {
    const response = deliverableResponseSchema.parse({
      replacements: {
        'instruction-1': 'Documented summary.',
      },
    });

    expect(response.replacements).toEqual([
      {
        id: 'instruction-1',
        content: 'Documented summary.',
      },
    ]);
  });

  it('normalizes array content into a markdown table', () => {
    const response = deliverableResponseSchema.parse({
      replacements: [
        {
          id: 'instruction-1',
          content: [
            {
              Solution: 'MFI / Synergie Web',
              'Points forts': '- Expertise par zones fixes',
            },
            {
              Solution: 'OREA',
              'Points forts': '- Expertise par polygones',
            },
          ],
        },
      ],
    });

    expect(response.replacements[0]?.content).toContain('| Solution | Points forts |');
    expect(response.replacements[0]?.content).toContain('| MFI / Synergie Web | - Expertise par zones fixes |');
    expect(response.replacements[0]?.content).toContain('| OREA | - Expertise par polygones |');
  });
});
