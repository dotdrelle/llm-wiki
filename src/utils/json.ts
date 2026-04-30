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
