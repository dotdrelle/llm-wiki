import { describe, expect, it } from 'vitest';
import { buildConsolidationPrompt, CONSOLIDATION_PROMPT_VERSION } from '../src/prompts/consolidationPrompt.ts';
import type { SourceDocument } from '../src/types.ts';

/*
 Politique de granularité (plan Lot 3, §6.1).

 La mesure ACPI a montré des comptes par source suspendus comme uniformes :
 sept sources, sept fois trois pages, etc., quelle que soit leur matière. Le
 prompt l'encourageait sur l'interprétation « default = 3 » d'une borne
 « zero to three by default ». Ce test verrouille le texte normatif : le défaut
 doit être ZÉRO, le nombre justifié par le contenu et non uniforme, et une page
 existante réutilisée avant d'en créer une nouvelle. Ramollir l'un de ces
 points doit casser ce test.
*/

const source: SourceDocument = {
  absolutePath: '/w/raw/untracked/x.md',
  relativePath: 'raw/untracked/x.md',
  archiveRelativePath: 'raw/ingested/x.md',
  archiveCitationPath: 'raw/ingested/outils/x.md',
  fileName: 'x.md',
  slug: 'x',
  title: 'Étude X',
  frontmatter: {},
  rawContent: 'content',
  body: 'body',
};

const args = {
  source,
  extraction: {
    facts: [],
    subjects: [],
    relations: [],
    mainSubject: null,
  },
  sourcePagePath: 'wiki/sources/x.md',
  existingSourceNote: null,
  inventory: [],
  indexContent: 'index',
  collection: null,
  ctx: { language: 'fr' },
};

describe('politique de granularité §6.1', () => {
  it('exige un défaut à zéro, pas trois', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system).toContain('at most three NEW ones per source');
    expect(system).toContain('zero is common');
    // L'ancienne lecture de la borne comme cible ne doit plus apparaître.
    expect(system).not.toContain('zero to three NEW concept pages');
  });

  it('exige une granularité justifiée par le contenu, non uniforme', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('justified by the content, not uniform');
    expect(system.toLowerCase()).toContain('unrelated documents should yield different counts');
  });

  it('interdit de créer une page quand une existante couvre déjà le sujet', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('reuse or update an existing concept page');
    expect(system.toLowerCase()).toContain('before creating a near-duplicate');
  });

  it('borne la création de produit à trois avec une justification par contenu', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('at most three new ones per source');
    expect(system.toLowerCase()).toContain('justified by content');
  });

  it('exige les dimensions transverses comme concepts partagés', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('transverse dimensions');
    expect(system.toLowerCase()).toContain('scope=transverse');
    expect(system.toLowerCase()).toContain('never one per product');
  });

  it('porte une version de prompt distincte pour invalider le cache', () => {
    expect(CONSOLIDATION_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });
});
