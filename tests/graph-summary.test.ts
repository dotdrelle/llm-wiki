import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { excerptSummary, graphDocumentSummary } from '../src/graph/wiki/summary.ts';

async function workspace() {
  return mkdtemp(path.join(tmpdir(), 'graph-summary-'));
}

const page = {
  title: 'Rate limiting',
  preview:
    'Requests are throttled per provider. The limiter shares one bucket per base URL. It is applied before retries.',
  contentEtag: '120-1700000000000',
};

describe('résumé de contexte du graphe', () => {
  it('appelle le LLM une fois, puis sert le cache', async () => {
    const rootDir = await workspace();
    let calls = 0;
    const complete = async () => {
      calls += 1;
      return '  Cette page décrit la limitation de débit par fournisseur.  ';
    };

    const first = await graphDocumentSummary({ rootDir, id: 'wiki/rate.md', ...page, complete });
    const second = await graphDocumentSummary({ rootDir, id: 'wiki/rate.md', ...page, complete });

    expect(first.source).toBe('llm');
    expect(first.summary).toBe('Cette page décrit la limitation de débit par fournisseur.');
    expect(second).toEqual(first);
    // Le cache est la seule chose qui rend une fiche ouvrable sans latence à
    // la deuxième visite : s'il ne mordait pas, chaque survol coûterait un
    // appel au fournisseur.
    expect(calls).toBe(1);
  });

  it('recalcule quand la page a changé, jamais quand elle n’a pas bougé', async () => {
    const rootDir = await workspace();
    const answers = ['Version un.', 'Version deux.'];
    const complete = async () => answers.shift() ?? 'épuisé';

    await graphDocumentSummary({ rootDir, id: 'wiki/rate.md', ...page, complete });
    const rewritten = await graphDocumentSummary({
      rootDir,
      id: 'wiki/rate.md',
      ...page,
      contentEtag: '134-1700000999999',
      complete,
    });

    // L'empreinte du fichier EST la clé : un ingest qui réécrit la page
    // invalide l'entrée sans qu'on ait à purger quoi que ce soit.
    expect(rewritten.summary).toBe('Version deux.');
    const cache = JSON.parse(
      await readFile(path.join(rootDir, '.wiki', 'cache', 'graph-summaries.json'), 'utf8'),
    );
    expect(cache['wiki/rate.md'].contentEtag).toBe('134-1700000999999');
  });

  it('rend un extrait plutôt que rien quand le LLM manque ou échoue', async () => {
    const rootDir = await workspace();

    const noLlm = await graphDocumentSummary({ rootDir, id: 'wiki/rate.md', ...page });
    const failing = await graphDocumentSummary({
      rootDir,
      id: 'wiki/rate.md',
      ...page,
      complete: async () => {
        throw new Error('provider unreachable');
      },
    });

    for (const result of [noLlm, failing]) {
      expect(result.source).toBe('excerpt');
      expect(result.summary.startsWith('Requests are throttled per provider.')).toBe(true);
    }
  });

  it('coupe l’extrait sur des phrases, pas au milieu d’un mot', () => {
    expect(excerptSummary('Un. Deux. Trois. Quatre.')).toBe('Un. Deux. Trois.');
    expect(excerptSummary('   ')).toBe('This page has no readable content yet.');
    expect(excerptSummary(`${'mot '.repeat(200)}`).endsWith('…')).toBe(true);
  });
});
