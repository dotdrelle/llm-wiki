import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeConceptGrid, type ConceptGridProposal } from '../src/ingest/conceptGridSynthesis.ts';

/*
 `synthesizeConceptGrid`'s retry loop claims the same discipline as the
 taxonomy synthesis ("reject-and-retry"), but unlike its siblings in
 simple.ts it called `deps.propose` with no try/catch — a single malformed
 JSON/schema-mismatch answer on attempt 1 of 3 crashed `wiki concepts --apply`
 outright instead of consuming a retry and reporting a clean rejection. This
 test locks the fixed behaviour: a throwing first attempt still recovers on
 attempt 2.
 */

const VALID_PROPOSAL: ConceptGridProposal = {
  classes: [
    {
      id: 'offre-marche',
      label: 'Offre marché',
      covers: 'Les solutions vendues par un éditeur.',
      criterion: 'Le document évalue-t-il un produit vendu par un éditeur ?',
      extensions: ['fiche du 6e éditeur', 'comparatif consolidé', 'réponses écrites'],
    },
    {
      id: 'economie-projet',
      label: 'Économie projet',
      covers: 'Ce que ça coûte.',
      criterion: 'Le document porte-t-il un montant ou une charge ?',
      extensions: ['chiffrage consolidé', 'coût complet à 5 ans', "note d'achat"],
    },
  ],
  assignments: {
    'raw/ingested/a.md': { primary: 'offre-marche', secondary: [] },
    'raw/ingested/b.md': { primary: 'economie-projet', secondary: [] },
  },
  outOfScope: [],
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'concept-grid-retry-'));
  await mkdir(path.join(root, 'raw', 'ingested'), { recursive: true });
  await writeFile(path.join(root, 'raw', 'ingested', 'a.md'), '# A\n\nUn document.\n', 'utf8');
  await writeFile(path.join(root, 'raw', 'ingested', 'b.md'), '# B\n\nUn autre document.\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('synthesizeConceptGrid — récupération après une réponse invalide', () => {
  it('consomme une tentative sur une erreur du modèle au lieu de planter la commande', async () => {
    let calls = 0;
    const propose = async (): Promise<ConceptGridProposal> => {
      calls += 1;
      if (calls === 1) throw new Error('The model returned malformed JSON and JSON repair failed.');
      return VALID_PROPOSAL;
    };

    const outcome = await synthesizeConceptGrid(root, { language: 'fr' }, { propose });

    expect(calls).toBe(2);
    expect(outcome.status).toBe('written');
  });

  it('rejette proprement quand toutes les tentatives échouent', async () => {
    const propose = async (): Promise<ConceptGridProposal> => {
      throw new Error('boom');
    };

    const outcome = await synthesizeConceptGrid(root, { language: 'fr' }, { propose });

    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.issues.join(' ')).toContain('boom');
    }
  });
});
