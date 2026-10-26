import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { REPORTS_DIR, writeDonnaReport } from '../src/services/reportWriter.ts';

describe('Donna reports', () => {
  it('writes a locked report under raw/untracked/Donna with an OKF header, never over another', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const now = new Date('2026-10-13T19:20:00Z');
    const first = await writeDonnaReport(root, {
      title: 'Résumé du comité de suivi', content: '# Résumé\n\nTrois décisions.', sources: ['raw/ingested/demo.md'], now,
    });
    expect(first.relativePath).toBe(`${REPORTS_DIR}/2026-10-13-resume-du-comite-de-suivi.md.lock`);
    const parsed = matter(await readFile(first.absolutePath, 'utf8'));
    expect(parsed.data).toMatchObject({
      type: 'report', title: 'Résumé du comité de suivi', status: 'draft',
      generated: { by: 'donna', at: now.toISOString() }, sources: ['raw/ingested/demo.md'],
    });
    expect(parsed.content.trim()).toBe('# Résumé\n\nTrois décisions.');
    // Same title the same day: a new file, the first one untouched.
    const second = await writeDonnaReport(root, { title: 'Résumé du comité de suivi', content: 'v2', now });
    expect(second.relativePath).toBe(`${REPORTS_DIR}/2026-10-13-resume-du-comite-de-suivi-2.md.lock`);
    expect(matter(await readFile(first.absolutePath, 'utf8')).content.trim()).toBe('# Résumé\n\nTrois décisions.');
  });

  it('refuses a report without a title or content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reports-'));
    await expect(writeDonnaReport(root, { title: ' ', content: 'x' })).rejects.toThrow(/title/);
    await expect(writeDonnaReport(root, { title: 'T', content: ' ' })).rejects.toThrow(/content/);
  });
});
