import { describe, expect, it } from 'vitest';
import {
  buildLocatorCatalogue,
  materializeLocatorTokens,
  renderLocatorCatalogueSection,
} from '../src/provenance/promptLocators.ts';

const DOC = '# Detailed\n\n## Coûts\n\n90 k€.\n\n## Sécurité\n\n### Chiffrement\n\nAES.\n';

describe('ingest locator wiring (lot 1)', () => {
  it('renders a bounded catalogue with tokens and previews', () => {
    const section = renderLocatorCatalogueSection(buildLocatorCatalogue(DOC));
    expect(section).toContain('section:Detailed > Coûts');
    expect(section).toContain('section:Detailed > Sécurité > Chiffrement');
    expect(section).toContain('Never write a line');
  });

  it('materializes a section token into the terminal address', () => {
    const content = '[src: raw/ingested/x.md#section:Detailed > Coûts]';
    const result = materializeLocatorTokens(content, { documentPath: 'raw/ingested/x.md', documentContent: DOC });
    expect(result.materialized).toBe(1);
    expect(result.unresolved).toEqual([]);
    expect(result.content).toBe('[src: raw/ingested/x.md#Detailed > Coûts]');
  });

  it('materializes a fragment token into a hashed line range', () => {
    const headingless = 'Une réunion.\n\nSans titre.\n';
    const catalogue = buildLocatorCatalogue(headingless);
    const token = catalogue.locators[0].token;
    const content = `[src: raw/ingested/x.md#${token}]`;
    const result = materializeLocatorTokens(content, { documentPath: 'raw/ingested/x.md', documentContent: headingless });
    expect(result.content).toMatch(/\[src: raw\/ingested\/x\.md#L\d+-\d+@sha256=[0-9a-f]{64}\]/);
  });

  it('leaves a citation to another document untouched', () => {
    const content = '[src: raw/ingested/other.md#section:Detailed > Coûts]';
    const result = materializeLocatorTokens(content, { documentPath: 'raw/ingested/x.md', documentContent: DOC });
    expect(result.materialized).toBe(0);
    expect(result.content).toBe(content);
  });

  it('reports an unresolvable token instead of dropping the claim', () => {
    const content = '[src: raw/ingested/x.md#section:Absent]';
    const result = materializeLocatorTokens(content, { documentPath: 'raw/ingested/x.md', documentContent: DOC });
    expect(result.materialized).toBe(0);
    expect(result.unresolved).toEqual(['section:Absent']);
    expect(result.content).toBe(content);
  });
});
