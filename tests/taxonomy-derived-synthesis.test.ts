import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeSimpleTaxonomy } from '../src/graph/wiki/taxonomy/simple.ts';

/*
 Chemin dérivé de la synthèse de taxonomie : quand une grille de concepts
 existe, les sous-domaines sont une jointure sur `class` et le modèle ne reçoit
 qu'une question — regrouper les classes en communautés. Ces deux tests verrouillent
 le câblage LLM de ce chemin : il exige `proposeJson` (forme `{domains,
 classDomains}`), et surtout il ne doit PAS retomber sur `propose` (forme
 `{domains, communities, assignments}`), qui brûlerait les trois tentatives sur
 un JSON qui ne peut jamais passer `domainProposalSchema`.
 */

const GRID = [
  '# Conceptual grid',
  '',
  '```yaml',
  'class:',
  '  - offre-marche',
  '  - securite',
  '```',
  '',
].join('\n');

const page = (cls: string, subject: string, body: string) =>
  `---\nclass: ${cls}\nsubject: ${subject}\n---\n\n# ${subject}\n\n${body}\n`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'taxonomy-derived-'));
  await mkdir(path.join(root, 'wiki', 'concepts', 'offre-marche'), { recursive: true });
  await mkdir(path.join(root, 'wiki', 'concepts', 'securite'), { recursive: true });
  await writeFile(path.join(root, 'wiki', 'concepts-grid.md'), GRID, 'utf8');
  await writeFile(path.join(root, 'wiki', 'concepts', 'offre-marche', 'x.md'), page('offre-marche', 'x', 'Market view.'), 'utf8');
  await writeFile(path.join(root, 'wiki', 'concepts', 'securite', 'x.md'), page('securite', 'x', 'Security view.'), 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('synthesizeSimpleTaxonomy — chemin dérivé (grille présente)', () => {
  it('ne tente pas le mauvais schéma : propose seul ⇒ no_llm, pas un rejet à blanc', async () => {
    // `propose` est câblé sur simpleSynthesisSchema. Le donner au chemin dérivé
    // brûlerait les 3 tentatives sur un JSON qui ne peut jamais passer. La
    // bonne réponse est de déclarer qu'il n'y a pas de complétion dérivée.
    const propose = async () => {
      throw new Error('propose must not be called on the derived path');
    };
    const outcome = await synthesizeSimpleTaxonomy(root, { language: 'fr' }, { propose });
    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') expect(outcome.reason).toBe('no_llm');
  });

  it('publie un registre dérivé quand proposeJson est câblé', async () => {
    const proposeJson = async () => ({
      domains: [{ id: 'd1', label: 'Pilotage' }],
      classDomains: { 'offre-marche': 'd1', securite: 'd1' },
    });
    const outcome = await synthesizeSimpleTaxonomy(root, { language: 'fr' }, { proposeJson });
    expect(outcome.status).toBe('published');
  });
});
