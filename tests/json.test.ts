import { describe, expect, it } from 'vitest';
import {
  extractFirstJsonCandidate,
  extractFirstJsonObject,
  repairIncompleteJson,
} from '../src/utils/json.ts';

describe('json utilities', () => {
  it('extracts the first full JSON object when complete', () => {
    expect(extractFirstJsonObject('prefix {"ok":true} suffix')).toBe('{"ok":true}');
  });

  it('extracts and repairs a truncated JSON payload', () => {
    const candidate = extractFirstJsonCandidate(
      'prefix {"summary":"ok","operations":[{"type":"create","path":"wiki/index.md",',
    );
    const repaired = repairIncompleteJson(candidate);

    expect(JSON.parse(repaired)).toEqual({
      summary: 'ok',
      operations: [
        {
          type: 'create',
          path: 'wiki/index.md',
        },
      ],
    });
  });
});
