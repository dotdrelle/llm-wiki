import { describe, expect, it } from 'vitest';
import { ingestPlanSchema } from '../src/config/schema.ts';

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
});
