import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryService } from '../src/services/historyService.ts';
import { handleWikiRoutes } from '../src/serve/routes/wikiRoutes.ts';

/*
  La page /history ne charge plus l'historique au rendu serveur : un git log
  sur un gros workspace laissait un écran blanc, sans état de chargement. Le
  shell s'affiche immédiatement avec un indicateur de chargement, puis le
  navigateur charge /api/history/summary — et le repli « Older history » se
  charge à l'ouverture via /api/history/older.
*/

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-history-page-'));
  roots.push(root);
  await Promise.all(['wiki', 'templates', 'build-context', 'deliverables', '.wiki']
    .map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  return root;
}

/** Rend une route de wikiRoutes et capture le HTML et le JSON produits. */
async function render(root: string, pathname: string): Promise<{ html: string; json: unknown; jsonStatus: number }> {
  let html = '';
  let json: unknown = null;
  let jsonStatus = 0;
  const res = {
    writeHead() {},
    end(body: string) { html = body; },
  } as never;
  const handled = await handleWikiRoutes({ method: 'GET', url: pathname } as never, res, pathname.split('?')[0], {
    rootDir: root,
    sendJson: (_res: unknown, status: number, data: unknown) => { jsonStatus = status; json = data; },
    readRequestBody: async () => '',
    sendGzippedHtml: async (_req: unknown, _res: unknown, body: string) => { html = body; },
  } as never);
  expect(handled).toBe(true);
  return { html, json, jsonStatus };
}

interface SummaryPayload {
  status: { initialized: boolean; reason?: string };
  release?: { name: string; date: string } | undefined;
  commits: Array<{ subject: string }>;
  olderCount: number;
}

async function summary(root: string): Promise<SummaryPayload> {
  const { json, jsonStatus } = await render(root, '/api/history/summary');
  expect(jsonStatus).toBe(200);
  return json as SummaryPayload;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('page /history autour d’un release', () => {
  it('sert un shell immédiat avec un état de chargement, pas l’historique rendu', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'a.md'), '# a\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: a' });

    const { html } = await render(root, '/history');

    expect(html).toContain('<section class="history-list"><div class="history-loading">');
    expect(html).toContain('>_</span> Loading history…');
    expect(html).toContain('id="history-archive"');
    expect(html).toContain('fetch(\'/api/history/summary\'');
    expect(html).toContain('fetch(\'/api/history/older?until=\'');
    // Le sujet du commit ne doit pas être rendu côté serveur.
    expect(html).not.toContain('>build: a<');
  });

  it('ne déclare pas l’historique vide quand tout est simplement passé sous le release', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    for (const name of ['a', 'b']) {
      await writeFile(path.join(root, 'wiki', `${name}.md`), `# ${name}\n`, 'utf8');
      await history.commit({ command: 'build', message: `build: ${name}` });
    }
    const release = await history.createRelease();

    // L'état exact que l'utilisateur voit : la page se recharge juste après le
    // tag, donc rien n'a encore été commité par-dessus. Le résumé le dit
    // sans parler d'un historique vide, et le repli annonce bien les commits
    // conservés avant le tag.
    const data = await summary(root);

    expect(data.commits).toHaveLength(0);
    expect(data.release?.name).toBe(release.name);
    expect(data.olderCount).toBe(2);

    const { html } = await render(root, '/history');
    expect(html).toContain('Nothing changed since ');
    expect(html).toContain('commit(s) before ');
  });

  it('compte séparément ce qui suit le release et ce qui le précède', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'a.md'), '# a\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: a' });
    const release = await history.createRelease();
    await writeFile(path.join(root, 'wiki', 'b.md'), '# b\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: b' });

    const data = await summary(root);

    // « 0 commit(s) » au-dessus d'un historique complet était le même mensonge
    // que la liste vide : le compteur ne portait que sur l'après-release.
    expect(data.commits).toHaveLength(1);
    expect(data.commits[0]?.subject).toBe('build: b');
    expect(data.release?.name).toBe(release.name);
    expect(data.olderCount).toBe(1);
  });

  it('sans release, garde son message et son compteur d’origine', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    await writeFile(path.join(root, 'wiki', 'a.md'), '# a\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: a' });

    const data = await summary(root);

    expect(data.release).toBeUndefined();
    expect(data.commits).toHaveLength(1);
    expect(data.olderCount).toBe(0);

    const { html } = await render(root, '/history');
    expect(html).toContain('No release yet');
  });

  it('charge le repli « Older history » paresseusement via /api/history/older', async () => {
    const root = await workspace();
    const history = new HistoryService(root);
    await history.initialize({ baseline: true });
    for (const name of ['a', 'b', 'c']) {
      await writeFile(path.join(root, 'wiki', `${name}.md`), `# ${name}\n`, 'utf8');
      await history.commit({ command: 'build', message: `build: ${name}` });
    }
    const release = await history.createRelease();
    await writeFile(path.join(root, 'wiki', 'd.md'), '# d\n', 'utf8');
    await history.commit({ command: 'build', message: 'build: d' });

    const { json, jsonStatus } = await render(root, `/api/history/older?until=${encodeURIComponent(release.name)}&limit=50`);
    expect(jsonStatus).toBe(200);
    const older = json as { commits: Array<{ subject: string }> };
    expect(older.commits.map((commit) => commit.subject)).toEqual(['build: c', 'build: b', 'build: a']);

    const missing = await render(root, '/api/history/older');
    expect(missing.jsonStatus).toBe(400);
  });
});
