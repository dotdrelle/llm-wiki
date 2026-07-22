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

  it('removes broken local links but preserves labels and source citations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-broken-links-'));
    await mkdir(path.join(root, 'wiki', 'concepts'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
    await mkdir(path.join(root, 'raw', 'archive'), { recursive: true });
    const page = path.join(root, 'wiki', 'concepts', 'page.md');
    await writeFile(path.join(root, 'wiki', 'concepts', 'valid.md'), '# Valid\n', 'utf8');
    await writeFile(path.join(root, 'raw', 'ingested', 'source.md'), '# Source\n', 'utf8');
    await writeFile(path.join(root, 'raw', 'archive', 'legacy.md'), '# Legacy\n', 'utf8');
    await writeFile(page, [
      '# Page',
      '[Valid](valid.md)',
      '[Missing](missing.md)',
      '[[absent.md|Absent reference]]',
      '[External](https://example.com)',
      '[Archived](raw/archive/legacy.md)',
      '[src: raw/ingested/source.md]',
    ].join('\n'), 'utf8');

    const html = await serveMd(root, page, '/wiki/concepts/page.md');
    expect(html).toContain('href="/wiki/concepts/valid.md"');
    expect(html).toContain('Missing');
    expect(html).toContain('Absent reference');
    expect(html).not.toContain('missing.md');
    expect(html).not.toContain('absent.md');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="/raw/archive/legacy.md"');
    expect(html).toContain('class="source-citation"');
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
    expect(html).toContain('1 kept');
    expect(html).toContain('1 modified');
    expect(html).toContain('1 inserted');
    expect(html).toContain(
      '<span class="section-tag section-tag-modified">modified</span>',
    );
    expect(html).toContain(
      '<span class="section-tag section-tag-inserted">new</span>',
    );
  });
});
