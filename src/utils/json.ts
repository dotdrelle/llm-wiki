export function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function fixUnescapedQuotes(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let stringRole: 'key' | 'value' = 'value';
  const stack: Array<
    | { type: 'object'; state: 'key' | 'afterKey' | 'value' | 'afterValue' }
    | { type: 'array'; state: 'value' | 'afterValue' }
  > = [];

  const top = () => stack[stack.length - 1];
  const markValueDone = () => {
    const current = top();
    if (!current) return;
    current.state = 'afterValue';
  };
  const nextNonWhitespace = (start: number): string => {
    let j = start;
    while (j < text.length && /[ \t\r\n]/.test(text[j] ?? '')) j++;
    return text[j] ?? '';
  };
  const isValueStart = (value: string): boolean =>
    value === '"' ||
    value === '{' ||
    value === '[' ||
    value === '-' ||
    /^[0-9tfn]$/.test(value);
  const isClosingQuote = (next: string, afterNextIndex: number): boolean => {
    if (next === '' || next === '}' || next === ']') return true;
    if (next === ':' && stringRole === 'key') return true;
    if (next !== ',') return false;

    const afterComma = nextNonWhitespace(afterNextIndex);
    const current = top();
    if (current?.type === 'object') {
      return afterComma === '"' || afterComma === '}';
    }
    if (current?.type === 'array') {
      return isValueStart(afterComma) || afterComma === ']';
    }

    return false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (!inString) {
      result += char;
      if (char === '{') {
        stack.push({ type: 'object', state: 'key' });
      } else if (char === '[') {
        stack.push({ type: 'array', state: 'value' });
      } else if (char === '}' || char === ']') {
        stack.pop();
        markValueDone();
      } else if (char === ':') {
        const current = top();
        if (current?.type === 'object' && current.state === 'afterKey') {
          current.state = 'value';
        }
      } else if (char === ',') {
        const current = top();
        if (!current) {
          // Comma outside any structure: let it through (model text).
        } else if (current.state === 'value') {
          // Literal value (null, true, false, number): it never goes through a
          // string, so the state remained 'value'. Mark it done before the
          // comma, otherwise the next key inherits a stringRole 'value' and its
          // quote gets altered into '\\"' → invalid JSON.
          markValueDone();
          if (current.type === 'object') current.state = 'key';
          else current.state = 'value';
        } else if (current?.type === 'object' && current.state === 'afterValue') {
          current.state = 'key';
        } else if (current?.type === 'array' && current.state === 'afterValue') {
          current.state = 'value';
        }
      } else if (char === '"') {
        const current = top();
        stringRole = current?.type === 'object' && current.state === 'key' ? 'key' : 'value';
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      let j = i + 1;
      while (j < text.length && /[ \t\r\n]/.test(text[j] ?? '')) j++;
      const next = text[j] ?? '';
      if (isClosingQuote(next, j + 1)) {
        result += char;
        inString = false;
        const current = top();
        if (stringRole === 'key' && current?.type === 'object') {
          current.state = 'afterKey';
        } else {
          markValueDone();
        }
      } else {
        result += '\\"';
      }
      continue;
    }

    result += char;
  }

  return result;
}

export function extractFirstJsonObject(text: string): string {
  const start = text.search(/[{[]/);
  if (start === -1) {
    throw new Error('No JSON object found in model response.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error('Incomplete JSON object found in model response.');
}

export function extractFirstJsonCandidate(text: string): string {
  const start = text.search(/[{[]/);
  if (start === -1) {
    throw new Error('No JSON object found in model response.');
  }

  return text.slice(start).trim();
}

/**
 * Whether the `"` at `quoteIndex` is escaped, by counting the run of `\`
 * immediately before it: an odd count means the quote itself is escaped
 * (part of the string content), an even count means it is a real boundary —
 * `\\"` (an escaped backslash then a real quote) must not be mistaken for
 * `\"` (an escaped quote), which a single character of look-behind cannot
 * tell apart.
 */
function isEscapedQuoteAt(text: string, quoteIndex: number): boolean {
  let backslashes = 0;
  let j = quoteIndex - 1;
  while (j >= 0 && text[j] === '\\') {
    backslashes += 1;
    j -= 1;
  }
  return backslashes % 2 === 1;
}

/**
 * The span of the LAST JSON-shaped chunk in the text — a fenced block if one
 * is present (last fence first: an earlier one may be a format example ahead
 * of the real, trailing answer), otherwise the outermost `{…}` found by
 * scanning backwards from the last `}` (a naive `lastIndexOf('{')` would land
 * on a nested brace, e.g. the assignments object). Returned as a raw string,
 * parsed or not — `extractTrailingJson` parses it and gives up on failure;
 * `extractTrailingJsonCandidate` hands the same span to the repair pipeline
 * instead, so a span that is well-formed but has a minor defect (an
 * unescaped quote, say) is still fed to `repairIncompleteJson` rather than
 * discarded.
 */
function findTrailingJsonSpan(trimmed: string): string | null {
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) {
    const last = fenced[fenced.length - 1]!;
    const inner = last.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (inner) return inner;
  }
  const end = trimmed.lastIndexOf('}');
  if (end < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = end; i >= 0; i -= 1) {
    const ch = trimmed[i]!;
    if (ch === '"' && !isEscapedQuoteAt(trimmed, i)) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '}') {
      depth += 1;
    } else if (ch === '{') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(i, end + 1);
    }
  }
  return null;
}

/**
 * The LAST balanced JSON object in the text, tolerating prose or a markdown
 * fence before it — the mirror image of `extractFirstJsonObject`, for a
 * response that may carry commentary or a reasoning trace ahead of its
 * answer (a model instructed to return "JSON only" is not guaranteed to
 * comply, especially a reasoning/agentic one, and `response_format:
 * json_object` is not sent to every engine — see `supportsJsonResponseFormat`
 * in `config/engineCapabilities.ts`).
 */
export function extractTrailingJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // not pure JSON
  }
  const span = findTrailingJsonSpan(trimmed);
  if (span === null) return null;
  try {
    return JSON.parse(span);
  } catch {
    return null;
  }
}

/**
 * The mirror of `extractFirstJsonCandidate` for the `'trailing'` extraction
 * mode: the LAST JSON-shaped span, returned untouched (not parsed) for the
 * caller to preprocess/repair — used by `parseJsonPayloadWithLocalRepair`'s
 * fallback so a trailing object with a fixable defect is repaired instead of
 * the repair pipeline reverting to the (wrong, in this mode) first bracket.
 */
export function extractTrailingJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const span = findTrailingJsonSpan(trimmed);
  if (span === null) {
    throw new Error('No JSON object found in model response.');
  }
  return span;
}

export function sanitizeJsonStringControlChars(candidate: string): string {
  let sanitized = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index] ?? '';

    if (inString) {
      if (escaped) {
        sanitized += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        sanitized += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        sanitized += char;
        inString = false;
        continue;
      }

      if (char === '\r') {
        sanitized += '\\n';
        if (candidate[index + 1] === '\n') {
          index += 1;
        }
        continue;
      }

      if (char === '\n') {
        sanitized += '\\n';
        continue;
      }

      if (char === '\t') {
        sanitized += '\\t';
        continue;
      }

      if (char < ' ') {
        sanitized += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }

    sanitized += char;
  }

  return sanitized;
}

export function repairIncompleteJson(candidate: string): string {
  let repaired = candidate.trim();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of repaired) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = stack[stack.length - 1];
      if (expected === char) {
        stack.pop();
      }
    }
  }

  if (escaped && repaired.endsWith('\\')) {
    repaired = repaired.slice(0, -1);
    escaped = false;
  }

  if (inString) {
    repaired += '"';
  }

  repaired = repaired.replace(/,\s*$/u, '');

  while (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/u, '');
    repaired += stack.pop();
  }

  return sanitizeJsonStringControlChars(repaired);
}
