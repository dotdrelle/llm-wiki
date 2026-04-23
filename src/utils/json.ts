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

  return repaired;
}
