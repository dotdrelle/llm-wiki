import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_ETAG_ALGORITHM,
  knowledgeEtag,
  listKnowledgeFiles,
} from '../src/graph/wiki/taxonomy/knowledge.ts';
import { publishCorpusRevision } from '../src/graph/wiki/taxonomy/publish.ts';
import { readMarker, taxonomyPaths } from '../src/graph/wiki/taxonomy/store.ts';

/*
 L'empreinte qui décide de la péremption d'un classement.

 `wikiGraphEtagForFiles` hache `mtime` + taille de TOUT le graphe — templates,
 contextes de build, deliverables, état de build. Un `build`, un `export` ou une
 simple copie du workspace suffisait donc à déclarer la taxonomie périmée. Un
 avertissement qui s'allume sans raison est un avertissement qu'on apprend à
 ignorer : c'est ainsi qu'un vrai écart de révision passe inaperçu.
*/

let root: string;

async function page(dir: string, name: string, body: string): Promise<void> {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, name), body, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-etag-'));
  await page('wiki/concepts', 'alpha.md', '---\ngroup: a\n---\n\n# Alpha\n\nContenu.\n');
  await page('wiki/sources', 'source-a.md', '# Source A\n\nNote.\n');
  await page('raw/ingested', 'brut-a.md', '# Brut A\n');
  await page('wiki', 'index.md', '# Wiki Index\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('périmètre de l’empreinte de connaissance', () => {
  it('ignore templates, contextes de build et deliverables', async () => {
    const before = await knowledgeEtag(root);

    await page('templates', 'rapport.md', '# Modèle\n\nNouveau.\n');
    await page('build-context', 'contexte.md', '# Contexte\n');
    await page('deliverables', 'rapport.md', '# Rapport généré\n');
    await writeFile(path.join(root, '.wiki', 'build-state.json'), '{"built":true}', 'utf8')
      .catch(async () => {
        await mkdir(path.join(root, '.wiki'), { recursive: true });
        await writeFile(path.join(root, '.wiki', 'build-state.json'), '{"built":true}', 'utf8');
      });

    expect(await knowledgeEtag(root)).toBe(before);
  });

  it('ignore le journal technique, réécrit à chaque job', async () => {
    const before = await knowledgeEtag(root);
    await page('wiki', 'log.md', '# Wiki Log\n\n- ingestion 12:04\n');
    expect(await knowledgeEtag(root)).toBe(before);
    expect(await listKnowledgeFiles(root)).not.toContain('wiki/log.md');
  });

  it('ignore la grille de concepts (fichier de contrôle, pas une page)', async () => {
    // `wiki/concepts-grid.md` est le plan de classement, pas une page de
    // connaissance : le classer ferait apparaître le fichier de contrôle comme
    // une feuille « Non classé » dans le graphe.
    const before = await knowledgeEtag(root);
    await page('wiki', 'concepts-grid.md', '# Conceptual grid\n\n```yaml\nclass:\n  - offre-marche\n  - securite\n```\n');
    expect(await knowledgeEtag(root)).toBe(before);
    expect(await listKnowledgeFiles(root)).not.toContain('wiki/concepts-grid.md');
  });

  it('change dès qu’une page concept change, pas quand une source brute bouge', async () => {
    const before = await knowledgeEtag(root);

    await page('wiki/concepts', 'alpha.md', '---\ngroup: a\n---\n\n# Alpha\n\nContenu révisé.\n');
    const afterWiki = await knowledgeEtag(root);
    expect(afterWiki).not.toBe(before);

    // Option A : l'archive brute et la note source sont HORS du corpus de
    // connaissance. Une ingestion qui ne touche que raw/ingested/ (ou
    // wiki/sources/) ne périmera donc plus la taxonomie — c'est le concept
    // extrait qui compte, pas la matière brute dont il est issu.
    await page('raw/ingested', 'brut-b.md', '# Brut B\n');
    expect(await knowledgeEtag(root)).toBe(afterWiki);

    await page('wiki/sources', 'source-a.md', '# Source A\n\nNote révisée.\n');
    expect(await knowledgeEtag(root)).toBe(afterWiki);
  });
});

describe('indépendance vis-à-vis du système de fichiers', () => {
  it('survit à une copie qui réécrit tous les mtimes', async () => {
    const before = await knowledgeEtag(root);

    /*
     Le scénario réel : `git clone`, `docker cp`, restauration de sauvegarde,
     bind mount. Le contenu est identique et pourtant chaque `mtime` est neuf.
     Une empreinte fondée dessus déclarerait le corpus modifié alors que
     personne n'a rien écrit.
    */
    const future = new Date(Date.now() + 60_000);
    for (const file of await listKnowledgeFiles(root)) {
      await utimes(path.join(root, file), future, future);
    }

    expect(await knowledgeEtag(root)).toBe(before);
  });

  it('ignore les fins de ligne et les blancs de fin', async () => {
    const before = await knowledgeEtag(root);
    await page('wiki/concepts', 'alpha.md', '---\r\ngroup: a\r\n---\r\n\r\n# Alpha\r\n\r\nContenu.  \r\n\r\n');
    expect(await knowledgeEtag(root)).toBe(before);
  });
});

describe('cache de hachage', () => {
  it('donne le même résultat avec ou sans cache', async () => {
    const cached = await knowledgeEtag(root);
    const cacheFile = path.join(taxonomyPaths(root).dir, 'knowledge-hash-cache.json');
    expect(JSON.parse(await readFile(cacheFile, 'utf8')).algorithm).toBe(KNOWLEDGE_ETAG_ALGORITHM);

    await rm(cacheFile, { force: true });
    expect(await knowledgeEtag(root, { cache: false })).toBe(cached);
    expect(await knowledgeEtag(root)).toBe(cached);
  });

  it('n’utilise mtime et taille que pour invalider, jamais dans l’empreinte', async () => {
    const before = await knowledgeEtag(root);

    // Contenu réécrit à l'identique : le cache est invalidé — l'inode a bougé —
    // mais le hash recalculé est le même, donc l'empreinte ne change pas.
    await page('wiki/concepts', 'alpha.md', '---\ngroup: a\n---\n\n# Alpha\n\nContenu.\n');
    expect(await knowledgeEtag(root)).toBe(before);
  });

  it('recale le hash quand un contenu change à mtime préservé', async () => {
    // `mtime` seul raterait une réécriture qui le restaure (sauvegarde, outil
    // préservant le timestamp) : `ctime`, lui, bouge à chaque écriture. Même
    // taille, contenu différent — le piège que mtime+taille ne voyait pas.
    const file = path.join(root, 'wiki', 'concepts', 'alpha.md');
    const before = await knowledgeEtag(root);
    const { mtimeMs } = await stat(file);

    await writeFile(file, '---\ngroup: a\n---\n\n# Alpha\n\nContenu!\n', 'utf8');
    await utimes(file, new Date(mtimeMs), new Date(mtimeMs));

    expect(await knowledgeEtag(root)).not.toBe(before);
  });
});

describe('publication de révision de corpus', () => {
  it('publie l’empreinte de connaissance et son algorithme', async () => {
    const published = await publishCorpusRevision(root);
    expect(published.status).toBe('published');

    const marker = await readMarker(root);
    expect(marker?.corpus).toBe(await knowledgeEtag(root));
    expect(marker?.corpusAlgorithm).toBe(KNOWLEDGE_ETAG_ALGORITHM);
  });

  it('ne crée pas de révision pour un build qui ne touche aucune connaissance', async () => {
    await publishCorpusRevision(root);
    const first = await readMarker(root);

    await page('deliverables', 'rapport.md', '# Rapport régénéré\n');
    await page('templates', 'rapport.md', '# Modèle modifié\n');
    const second = await publishCorpusRevision(root);

    expect(second.status).toBe('published');
    expect((await readMarker(root))?.revision).toBe(first?.revision);
  });

  it('republie une fois pour migrer un marqueur historique', async () => {
    /*
     Marqueur d'avant le Lot 0 : une empreinte large, sans algorithme déclaré.
     Elle n'est comparable à rien. La traiter comme une empreinte différente
     serait vrai par accident ; la traiter comme égale serait faux. La seule
     réponse honnête est de republier une fois.
    */
    await mkdir(taxonomyPaths(root).dir, { recursive: true });
    await writeFile(
      taxonomyPaths(root).marker,
      JSON.stringify({
        revision: 7,
        corpus: 'legacy-wide-etag',
        registryRef: null,
        registryHash: null,
        publishedAt: Date.now(),
      }),
      'utf8',
    );

    const outcome = await publishCorpusRevision(root);
    expect(outcome.status).toBe('published');

    const marker = await readMarker(root);
    expect(marker?.revision).toBe(8);
    expect(marker?.corpusAlgorithm).toBe(KNOWLEDGE_ETAG_ALGORITHM);
  });
});
