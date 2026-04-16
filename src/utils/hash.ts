import { createHash } from 'node:crypto';

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashParts(parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\n---\n');
  }
  return hash.digest('hex');
}
