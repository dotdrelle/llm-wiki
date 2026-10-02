import { describe, expect, it, vi } from 'vitest';
import { closeSheetCandidates, exactSheetDuplicate, sheetContentHash, sheetInputHash, type SheetIndexEntry } from '../src/ingest/sheetDedup.ts';
import { IngestService } from '../src/services/ingestService.ts';
import type { AppConfig } from '../src/types.ts';
import type { TaxoRow } from '../src/ingest/taxoConsolidation.ts';

describe('TAXO fiche dedup candidates', () => {
  const index = [
    { path: 'wiki/sources/a/network.md', title: 'Réseau régional', description: 'Configuration MPLS', contentHash: 'same' },
    { path: 'wiki/sources/b/security.md', title: 'Sécurité des accès', description: 'Gestion des comptes' },
    { path: 'wiki/sources/c/router.md', title: 'Routeur MPLS', description: 'Équipement réseau régional' },
  ];

  it('finds exact content duplicates independently of source path and line range', () => {
    expect(exactSheetDuplicate('same', index)?.path).toBe('wiki/sources/a/network.md');
    expect(exactSheetDuplicate('', index)).toBeNull();
    const body = 'Les mêmes faits exacts.';
    const signature = 'prompt:model:fr';
    expect(sheetContentHash(body, signature)).toBe(sheetContentHash(body, signature));
    expect(sheetInputHash('raw/ingested/a.md', 1, 2, body, signature))
      .not.toBe(sheetInputHash('raw/ingested/b.md', 8, 9, body, signature));
    const duplicate = { path: 'wiki/sources/a/fiche.md', title: 'Fiche', contentHash: sheetContentHash(body, signature) };
    expect(exactSheetDuplicate(sheetContentHash(body, signature), [duplicate])).toBe(duplicate);
  });

  it('returns only a bounded, relevance-ranked set for the model decision', () => {
    const candidates = closeSheetCandidates('Routeur MPLS', 'Équipement de coeur', index, 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe('wiki/sources/c/router.md');
  });

  it('only skips when the model names a valid bounded duplicate candidate', async () => {
    const candidate: SheetIndexEntry = { path: 'wiki/sources/a/network.md', title: 'Réseau régional' };
    const completeText = vi.fn().mockResolvedValue('DUPLICATE 1');
    const service = new IngestService(
      {} as AppConfig,
      {} as never,
      { completeText } as never,
      {} as never,
      {} as never,
      { warn: vi.fn(), info: vi.fn() } as never,
    );
    const invoke = (service as unknown as {
      isCloseSheetDuplicate: (row: TaxoRow, candidates: SheetIndexEntry[], source: string) => Promise<SheetIndexEntry | null>;
    }).isCloseSheetDuplicate.bind(service);
    const row: TaxoRow = {
      row: 1, source: 'raw/untracked/a.md', heading: 'Réseau', locator: '1-4',
      facts: 'Contenu documenté.',
    };

    await expect(invoke(row, [candidate], row.source)).resolves.toBe(candidate);
    completeText.mockResolvedValueOnce('DUPLICATE 9');
    await expect(invoke(row, [candidate], row.source)).resolves.toBeNull();
  });
});
