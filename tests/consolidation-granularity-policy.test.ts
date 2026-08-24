import { describe, expect, it } from 'vitest';
import { buildConsolidationPrompt, CONSOLIDATION_PROMPT_VERSION } from '../src/prompts/consolidationPrompt.ts';
import { UNCLASSIFIED_CLASS } from '../src/ingest/conceptGrid.ts';
import type { SourceDocument } from '../src/types.ts';

/*
 Politique pré-grille (ex « granularité », plan Lot 3 §6.1).

 Une grille fermée n'existe pas encore : toute page concept est une feuille sous
 la classe réservée `unclassified`. Rien n'est inventé, rien n'est perdu — la
 feuille attend qu'une grille existe (ou qu'un humain la range dans une vraie
 classe). Ce test verrouille ce comportement : si on remet le modèle à inventer
 des pages-produit ou des dimensions à la volée, il casse.
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

describe('politique pré-grille (unclassified)', () => {
  it('signale l’absence de grille plutôt que de laisser inventer des classes', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system).toContain('NO conceptual grid');
  });

  it('range chaque feuille sous la classe réservée unclassified', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system).toContain(`wiki/concepts/${UNCLASSIFIED_CLASS}/<subject>.md`);
    expect(system).toContain(`"class" field is ${UNCLASSIFIED_CLASS}`);
  });

  it('impose une feuille par sujet, jamais une page par titre', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('one leaf per subject');
    expect(system.toLowerCase()).toContain('never create one page per heading');
  });

  it('interdit de créer une feuille quand une existante couvre déjà le sujet', () => {
    const { system } = buildConsolidationPrompt(args as never);
    expect(system.toLowerCase()).toContain('reuse or update an existing leaf');
    expect(system.toLowerCase()).toContain('never recreated under another name');
  });

  it('porte une version de prompt distincte pour invalider le cache', () => {
    expect(CONSOLIDATION_PROMPT_VERSION).toBeGreaterThanOrEqual(4);
  });

  it('rend le marqueur de sujet apparenté dans l\'inventaire des pages existantes', () => {
    const { user } = buildConsolidationPrompt({
      ...args,
      inventory: [
        {
          path: 'wiki/concepts/unclassified/gamma.md',
          title: 'Gamma',
          subject: 'gamma',
          scope: 'product',
          class: UNCLASSIFIED_CLASS,
          excerpt: 'Solution de planification.',
          subjectMatch: true,
        },
      ],
    } as never);
    expect(user).toContain('wiki/concepts/unclassified/gamma.md');
    expect(user).toContain('[existing page for a closely related subject]');
  });
});
