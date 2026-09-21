import { describe, expect, it } from 'vitest';
import { buildConsolidationUser } from '../src/prompts/consolidationPrompt.ts';
import type { ConsolidationInventoryPage } from '../src/prompts/consolidationPrompt.ts';
import type { SourceDocument } from '../src/types.ts';
import type { SourceExtraction } from '../src/ingest/extractionSchema.ts';

function args(inventory: ConsolidationInventoryPage[]): Parameters<typeof buildConsolidationUser>[0] {
  return {
    source: {
      archiveCitationPath: 'raw/ingested/a.md',
      title: 'A',
      body: 'source body',
    } as unknown as SourceDocument,
    extraction: {
      facts: [],
      subjects: [],
      relations: [],
      mainSubject: null,
    } as unknown as SourceExtraction,
    sourcePagePath: 'wiki/sources/a.md',
    existingSourceNote: null,
    inventory,
    indexContent: '',
    existingFolders: [],
    existingTags: [],
  };
}

describe('§3.4 update context (lot 3)', () => {
  it('renders the full existing body and the already-cited source excerpts', () => {
    const user = buildConsolidationUser(args([
      {
        path: 'wiki/concepts/demo/x.md',
        title: 'X',
        subject: 'x',
        scope: null,
        folder: 'demo',
        excerpt: 'a truncated whisper',
        existingBody: 'FULL BODY — statement from source A',
        sourceExcerpts: [{ path: 'raw/ingested/b.md', excerpt: 'complement from B' }],
      },
    ]));

    expect(user).toContain('FULL existing body to keep and extend:');
    expect(user).toContain('FULL BODY — statement from source A');
    expect(user).toContain('already-cited sources');
    expect(user).toContain('raw/ingested/b.md');
    expect(user).toContain('complement from B');
  });

  it('keeps the legacy excerpt shape when no enriched context is present', () => {
    const user = buildConsolidationUser(args([
      { path: 'wiki/concepts/demo/y.md', title: 'Y', subject: 'y', scope: null, folder: 'demo', excerpt: 'plain excerpt' },
    ]));
    expect(user).toContain('plain excerpt');
    expect(user).not.toContain('FULL existing body');
  });
});
