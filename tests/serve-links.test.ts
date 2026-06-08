import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractIndexTiles,
  isRawDownloadRequestPath,
  isRawUntrackedReference,
  localHref,
  serveMd,
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

  it('renders stabilization tags from deliverable sidecars', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-serve-sidecar-'));
    await mkdir(path.join(root, 'wiki'), { recursive: true });
    await mkdir(path.join(root, 'deliverables'), { recursive: true });
    await writeFile(path.join(root, 'wiki', 'index.md'), '# Wiki Index\n', 'utf8');
    const deliverablePath = path.join(root, 'deliverables', 'brief.md');
    await writeFile(
      deliverablePath,
      ['# Brief', '', '## Changed', '', 'Updated value.', '', '## Added', '', 'New section.'].join(
        '\n',
      ),
      'utf8',
    );
    await writeFile(
      path.join(root, 'deliverables', '.changes.brief.md.json'),
      JSON.stringify({
        stabilizedAt: '2026-06-08T10:30:00.000Z',
        kept: ['Brief > Stable'],
        merged: ['Brief > Changed'],
        inserted: ['Brief > Added'],
        removed: [],
      }),
      'utf8',
    );

    const html = await serveMd(root, deliverablePath, '/deliverables/brief.md');

    expect(html).toContain('class="stabilize-badge"');
    expect(html).toContain('1 conservée');
    expect(html).toContain('1 modifiée');
    expect(html).toContain('1 insérée');
    expect(html).toContain(
      '<span class="section-tag section-tag-modified">modifié</span>',
    );
    expect(html).toContain(
      '<span class="section-tag section-tag-inserted">nouveau</span>',
    );
  });
});
