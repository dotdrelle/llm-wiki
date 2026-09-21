import { describe, expect, it } from 'vitest';
import {
  buildLocatorCatalogue,
  materializeLocator,
  parseHeadingPath,
  resolveAnchor,
  serializeHeadingPath,
} from '../src/provenance/locators.ts';

describe('provenance locators (lot 1)', () => {
  it('round-trips reserved characters through the heading codec', () => {
    const parts = ['Sécurité', 'Chiffrement > #1', '100 % sûr'];
    const serialized = serializeHeadingPath(parts);
    expect(serialized).toContain('%3E');
    expect(serialized).toContain('%23');
    expect(serialized).toContain('%25');
    expect(parseHeadingPath(serialized)).toEqual(parts);
  });

  it('offers a unique heading path as a section locator and materializes its address', () => {
    const doc = '# Detailed\n\n## Coûts\n\nLicence.\n\n## Sécurité\n\n### Chiffrement\n\nAES.\n';
    const { locators } = buildLocatorCatalogue(doc);
    const tokens = locators.filter((entry) => entry.kind === 'section').map((entry) => entry.token);
    expect(tokens).toContain('section:Detailed > Coûts');
    expect(tokens).toContain('section:Detailed > Sécurité > Chiffrement');

    const materialized = materializeLocator(doc, 'section:Detailed > Sécurité > Chiffrement');
    expect(materialized?.anchor).toBe('Detailed > Sécurité > Chiffrement');
    expect(materialized?.text).toContain('AES.');
  });

  it('refuses an ambiguous full path and falls back to synthetic fragments', () => {
    const doc = '# Repeated\n\n## Coûts\n\nfirst\n\n## Coûts\n\nsecond\n';
    const { locators } = buildLocatorCatalogue(doc);
    // The repeated path is never offered as a section; only the unique `# Repeated`.
    expect(locators.some((entry) => entry.kind === 'section' && entry.token.includes('Coûts'))).toBe(false);
    const fragment = locators.find((entry) => entry.kind === 'fragment');
    expect(fragment).toBeTruthy();

    const materialized = materializeLocator(doc, fragment!.token);
    expect(materialized?.anchor).toMatch(/^L\d+-\d+@sha256=[0-9a-f]{64}$/);
    // The address is recomputed, never stored: same input, same anchor.
    expect(materializeLocator(doc, fragment!.token)?.anchor).toBe(materialized?.anchor);
  });

  it('produces fragments for a document without headings', () => {
    const doc = 'Une réunion.\n\nSans titre.\n';
    const { locators } = buildLocatorCatalogue(doc);
    expect(locators.length).toBeGreaterThan(0);
    expect(locators.every((entry) => entry.kind === 'fragment')).toBe(true);
  });

  it('resolves a unique title, reports an ambiguous one, and misses an absent one', () => {
    const doc = '# Doc\n\n## Coûts\n\na\n\n## Sécurité\n\nb\n';
    expect(resolveAnchor(doc, 'Sécurité').status).toBe('resolved');
    expect(resolveAnchor(doc, 'Doc > Sécurité').status).toBe('resolved');
    expect(resolveAnchor(doc, 'Absent').status).toBe('missing');

    const repeated = '# Doc\n\n## Coûts\n\na\n\n## Coûts\n\nb\n';
    expect(resolveAnchor(repeated, 'Coûts').status).toBe('ambiguous');
  });

  it('materializes a percent-encoded section token (the model URL-encodes it)', () => {
    const doc = '# Detailed\n\n## Sécurité\n\n### Chiffrement\n\nAES.\n';
    const token = `section:${encodeURIComponent('Detailed > Sécurité > Chiffrement')}`;
    const materialized = materializeLocator(doc, token);
    expect(materialized?.anchor).toBe('Detailed > Sécurité > Chiffrement');
  });

  it('bounds the catalogue and announces truncation', () => {
    const doc = Array.from({ length: 30 }, (_, index) => `## Section ${index}\n\ntext ${index}\n`).join('\n');
    const { locators, truncated } = buildLocatorCatalogue(doc, { maxEntries: 5 });
    expect(locators.length).toBe(5);
    expect(truncated).toBe(true);
  });
});
