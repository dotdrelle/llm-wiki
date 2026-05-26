import { describe, expect, it } from 'vitest';
import {
  extractIndexTiles,
  isRawDownloadRequestPath,
  isRawUntrackedReference,
  localHref,
} from '../src/commands/serve.ts';

describe('serve link handling', () => {
  it('keeps wiki index concept and source links clickable', () => {
    const sections = extractIndexTiles(`# Wiki Index

## Concepts

- [Customer Journey](concepts/customer-journey.md)
- [[sources/legacy-export.md|Legacy Export]]
- Source-only entry [src: raw/ingested/legacy-export.md]
`);

    expect(sections[0]?.tiles.map((tile) => tile.href)).toEqual([
      '/wiki/concepts/customer-journey.md',
      '/wiki/sources/legacy-export.md',
      '/raw/ingested/legacy-export.md',
    ]);
  });

  it('serves raw ingested links as local documents instead of raw downloads', () => {
    expect(localHref('raw/ingested/source.md', 'wiki/concepts')).toBe(
      '/raw/ingested/source.md',
    );
    expect(isRawUntrackedReference('raw/ingested/source.md')).toBe(false);
    expect(isRawDownloadRequestPath('/raw/ingested/source.md')).toBe(false);
    expect(isRawDownloadRequestPath('/raw/wiki/concepts/customer-journey.md')).toBe(true);
  });
});
