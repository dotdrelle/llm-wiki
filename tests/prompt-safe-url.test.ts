import { describe, expect, it } from 'vitest';
import { promptSafeBaseUrl } from '../src/utils/promptSafeUrl.ts';

describe('promptSafeBaseUrl', () => {
  it('keeps a plain base URL as is', () => {
    expect(promptSafeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(promptSafeBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('drops credentials, query and fragment, and says so', () => {
    expect(promptSafeBaseUrl('https://alice:s3cr3t@gw.example.com/v1'))
      .toBe('https://gw.example.com/v1 (credentials withheld)');
    const safe = promptSafeBaseUrl('https://bob:pw@gw.example.com/openai?api-key=q-secret#x');
    expect(safe).toBe('https://gw.example.com/openai (credentials, query, fragment withheld)');
    for (const secret of ['bob', 'pw', 'q-secret']) expect(safe).not.toContain(secret);
  });

  it('withholds an unparseable value instead of echoing it', () => {
    expect(promptSafeBaseUrl('not a url s3cr3t')).toBe('(withheld: not a parseable URL)');
    expect(promptSafeBaseUrl(undefined)).toBe('unset');
    expect(promptSafeBaseUrl('  ')).toBe('unset');
  });
});
