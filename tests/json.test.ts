import { describe, expect, it } from 'vitest';
import {
  extractFirstJsonCandidate,
  extractFirstJsonObject,
  fixUnescapedQuotes,
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

  it('keeps key colons structural while escaping quoted labels inside values', () => {
    const raw =
      '{"operations":[{"type":"create","path":"wiki/sources/test.md","content":"# Test\\n\\nLe champ "Objectif": remplacer le système."}]}';
    const repaired = fixUnescapedQuotes(raw);

    expect(JSON.parse(repaired)).toEqual({
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/test.md',
          content: '# Test\n\nLe champ "Objectif": remplacer le système.',
        },
      ],
    });
  });

  it('escapes quoted text followed by a comma inside object string values', () => {
    const raw =
      '{"operations":[{"type":"create","path":"wiki/sources/test.md","content":"# Test\\n\\nLe projet "ACME", destiné aux utilisateurs, remplace le système."}]}';
    const repaired = fixUnescapedQuotes(raw);

    expect(JSON.parse(repaired)).toEqual({
      operations: [
        {
          type: 'create',
          path: 'wiki/sources/test.md',
          content:
            '# Test\n\nLe projet "ACME", destiné aux utilisateurs, remplace le système.',
        },
      ],
    });
  });
});
