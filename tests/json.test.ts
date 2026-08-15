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

  it('keeps literal JSON values (null) without corrupting the following key', () => {
    // Une page concept "product" n'a pas de collection : `"collection": null`.
    // La valeur littérale `null` ne passe jamais par une chaîne, l'état du
    // parseur restait 'value' et la clé suivante héritait d'un stringRole
    // erroné → le guillemet de sa valeur était échappé en '\\"' → JSON invalide.
    // (Régression observée sur la consolidation Pigment, lot 3 §6.1.)
    const raw =
      '[ { "subject": "pigment", "collection": null, "scope": "product" }, { "subject": "index", "collection": null, "scope": "workspace" } ]';
    const repaired = fixUnescapedQuotes(raw);

    expect(JSON.parse(repaired)).toEqual([
      { subject: 'pigment', collection: null, scope: 'product' },
      { subject: 'index', collection: null, scope: 'workspace' },
    ]);
  });

  it('keeps literal number values without corrupting the following key', () => {
    const raw = '{"pages":[{"count": 2}, {"count": 4}]}';
    const repaired = fixUnescapedQuotes(raw);

    expect(JSON.parse(repaired)).toEqual({ pages: [{ count: 2 }, { count: 4 }] });
  });
});

