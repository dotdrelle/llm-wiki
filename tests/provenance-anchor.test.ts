import { describe, expect, it } from 'vitest';
import { anchorCitations } from '../src/provenance/anchor.ts';

const DOCS = new Map<string, string>([
  ['raw/ingested/x.md', '# X\n\n## Coûts\n\nLa licence coûte 90 k€ par an.\n\n## Sécurité\n\nLe chiffrement est activé au repos.\n'],
  ['raw/ingested/mono.md', '# Mono\n\nTout le document, sans sous-section.\n'],
]);
const load = (documentPath: string): string | null => DOCS.get(documentPath) ?? null;

describe('engine-side anchoring', () => {
  it('anchors an unanchored citation to the section that backs the claim', () => {
    const content = '## Coûts\n\nLa licence coûte 90 k€ par an. [src: raw/ingested/x.md]\n';
    const result = anchorCitations(content, load);
    expect(result.content).toBe('## Coûts\n\nLa licence coûte 90 k€ par an. [src: raw/ingested/x.md#X > Coûts]\n');
    expect(result.anchored).toBe(1);
  });

  it('leaves the citation alone when no section matches confidently', () => {
    const content = '## Divers\n\nUn propos sans rapport avec les sections. [src: raw/ingested/x.md]\n';
    const result = anchorCitations(content, load);
    expect(result.content).toContain('[src: raw/ingested/x.md]');
    expect(result.anchored).toBe(0);
  });

  it('does not anchor when the document has no sub-section', () => {
    const content = '## Résumé\n\nUne phrase. [src: raw/ingested/mono.md]\n';
    const result = anchorCitations(content, load);
    expect(result.anchored).toBe(0);
    expect(result.noSection).toEqual(['raw/ingested/mono.md']);
  });

  it('never rewrites an already-anchored citation', () => {
    const content = '## Coûts\n\nLa licence. [src: raw/ingested/x.md#X > Coûts]\n';
    const result = anchorCitations(content, load);
    expect(result.content).toBe(content);
    expect(result.anchored).toBe(0);
  });
});
