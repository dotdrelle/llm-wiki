import { describe, expect, it } from 'vitest';
import {
  extractFirstJsonCandidate,
  extractFirstJsonObject,
  repairIncompleteJson,
  sanitizeJsonStringControlChars,
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

  it('sanitizes literal newlines inside JSON strings', () => {
    const raw = '{"replacements":[{"id":"instruction-1","content":"line 1\nline 2"}]}';
    const sanitized = sanitizeJsonStringControlChars(raw);

    expect(JSON.parse(sanitized)).toEqual({
      replacements: [
        {
          id: 'instruction-1',
          content: 'line 1\nline 2',
        },
      ],
    });
  });

  it('does not change escaped newlines or structural whitespace', () => {
    const raw = '{\n  "content": "line 1\\nline 2"\n}';

    expect(sanitizeJsonStringControlChars(raw)).toBe(raw);
  });
});
