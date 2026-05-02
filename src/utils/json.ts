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
        if (current?.type === 'object' && current.state === 'afterValue') {
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
