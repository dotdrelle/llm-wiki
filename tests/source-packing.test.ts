import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { normalizeSourceBody } from '../src/utils/markdown.ts';
import { planSourcePacks, splitSourceSections } from '../src/utils/sourcePacking.ts';

/*
 Ce que le Lot 1 doit garantir : le nombre d'appels LLM suit le VOLUME d'une
 source, pas sa mise en forme.

 Mesures d'origine sur ACPI : Anaplan, 14 868 caractères, douze appels ; Board,
 19 838 caractères, cinq appels. Le découpage coupait à chaque titre sans jamais
 ré-empaqueter, si bien que la hiérarchie précise des titres pesait plus lourd
 que la richesse du document.
*/

const sentence = 'Phrase de contenu descriptif sur le produit et ses fonctions.';
const filler = (count: number) => Array.from({ length: count }, () => sentence).join(' ');
const chars = (plan: ReturnType<typeof planSourcePacks>) => plan.packs.map((pack) => pack.chars);

describe('ré-empaquetage des sections', () => {
  it('réunit les petites sections adjacentes jusqu’à la limite', () => {
    const document = ['# Doc', ...Array.from({ length: 12 }, (_, index) =>
      `## Rubrique ${index + 1}\n\n${filler(3)}`)].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 4000 });

    // Douze titres, un seul appel : c'est le volume qui décide.
    expect(plan.diagnostics.headings).toBe(12);
    expect(plan.packs).toHaveLength(1);
    expect(plan.packs[0]!.reason).toBe('whole');
  });

  it('ne multiplie pas les lots quand on ajoute des titres à contenu constant', () => {
    /*
     Le test de non-régression du § 4.3. C'est exactement la différence entre
     Anaplan et Board : même matière, découpage éditorial différent.
    */
    const body = filler(120);
    const flat = `# Doc\n\n## Tout\n\n${body}`;
    const chopped = ['# Doc', ...body.split('. ').map((part, index) =>
      `## Titre ${index}\n\n${part.trim()}${part.endsWith('.') ? '' : '.'}`)].join('\n\n');

    const flatPlan = planSourcePacks(flat, { maxChars: 8000 });
    const choppedPlan = planSourcePacks(chopped, { maxChars: 8000 });

    expect(flatPlan.packs.length).toBe(1);
    // Les titres ajoutent des caractères, jamais un facteur : au plus un lot
    // d'écart, contre un facteur douze auparavant.
    expect(choppedPlan.packs.length).toBeLessThanOrEqual(flatPlan.packs.length + 1);
  });

  it('respecte la limite mesurée sur le texte réellement émis', () => {
    const document = ['# Doc', ...Array.from({ length: 20 }, (_, index) =>
      `## S${index}\n\n${filler(10)}`)].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 3000 });

    expect(plan.packs.length).toBeGreaterThan(1);
    for (const pack of plan.packs) {
      expect(pack.text.length).toBe(pack.chars);
      expect(pack.chars).toBeLessThanOrEqual(3000);
    }
  });

  it('réserve le budget consommé par l’enveloppe du prompt', () => {
    const document = ['# Doc', `## S\n\n${filler(20)}`].join('\n\n');

    const withoutOverhead = planSourcePacks(document, { maxChars: 2000 });
    const withOverhead = planSourcePacks(document, { maxChars: 2000, overhead: 1500 });

    expect(Math.max(...chars(withoutOverhead))).toBeLessThanOrEqual(2000);
    expect(Math.max(...chars(withOverhead))).toBeLessThanOrEqual(500);
  });
});

describe('ordre, hiérarchie et contexte', () => {
  it('conserve l’ordre du document et le chemin de titres', () => {
    const document = ['# Produit', `## Un\n\n${filler(30)}`, `## Deux\n\n${filler(30)}`].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 1200 });

    expect(plan.packs.length).toBeGreaterThan(1);
    // Chaque lot reste rattaché au document : un fragment sans son titre
    // parlerait de rien.
    expect(plan.packs.every((pack) => pack.text.startsWith('# Produit'))).toBe(true);
    expect(plan.packs[0]!.text.indexOf('## Un')).toBeGreaterThan(-1);
    expect(plan.packs.at(-1)!.text).toContain('## Deux');
    expect(plan.packs[0]!.headingPath[0]).toBe('Produit');
  });

  it('descend en ### seulement pour une section trop grande', () => {
    const document = [
      '# Doc',
      `## Petite\n\n${filler(2)}`,
      `## Grande\n\n### A\n\n${filler(25)}\n\n### B\n\n${filler(25)}`,
    ].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 1800 });

    const texts = plan.packs.map((pack) => pack.text);
    expect(texts.some((text) => text.includes('### A'))).toBe(true);
    expect(texts.some((text) => text.includes('### B'))).toBe(true);
    // La sous-section reste précédée de la section qui la porte.
    for (const text of texts.filter((item) => item.includes('###'))) {
      expect(text).toContain('## Grande');
    }
  });

  it('coupe par paragraphes une sous-section encore trop grande', () => {
    const document = [
      '# Doc',
      `## Section\n\n### Sous\n\n${filler(15)}\n\n${filler(15)}\n\n${filler(15)}`,
    ].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 1400 });

    expect(plan.packs.length).toBeGreaterThan(1);
    expect(plan.packs.some((pack) => pack.reason === 'paragraph')).toBe(true);
    expect(plan.packs.every((pack) => pack.truncated === false)).toBe(true);
  });

  it('ne coupe pas sur un titre situé dans un bloc de code', () => {
    /*
     Un `## ` en première colonne d'un bloc clôturé est du texte. Couper dessus
     produisait un lot ouvrant un bloc que rien ne referme, et un autre
     commençant au milieu d'un exemple.
    */
    const document = ['# Doc', '## Exemple', '', '```md', '## Pas un titre', 'contenu', '```'].join('\n');

    const plan = planSourcePacks(document, { maxChars: 200 });

    expect(plan.packs).toHaveLength(1);
    expect(plan.diagnostics.headings).toBe(1);
  });

  it('reconnaît aussi les blocs délimités par des tildes', () => {
    /*
     `~~~` est le recours habituel quand le bloc contient lui-même des
     backticks — donc précisément dans les documents qui citent du Markdown,
     ceux où un `##` d'exemple est le plus probable.
    */
    const document = [
      '# Doc',
      '## Exemple',
      '',
      '~~~md',
      '## Pas un titre',
      '```',
      'du code imbriqué',
      '```',
      '~~~',
    ].join('\n');

    const plan = planSourcePacks(document, { maxChars: 200 });

    expect(plan.packs).toHaveLength(1);
    expect(plan.diagnostics.headings).toBe(1);
    // Le bloc reste entier, clôture comprise.
    expect(plan.packs[0]!.text).toContain('~~~md');
    expect(plan.packs[0]!.text.trimEnd().endsWith('~~~')).toBe(true);
  });

  it('ne referme pas un bloc backticks sur un délimiteur tilde', () => {
    const document = ['# Doc', '## S', '', '```', '~~~', '## Toujours du code', '```'].join('\n');

    const plan = planSourcePacks(document, { maxChars: 200 });

    expect(plan.packs).toHaveLength(1);
    expect(plan.diagnostics.headings).toBe(1);
  });
});

describe('troncature et diagnostics', () => {
  it('ne tronque qu’un bloc réellement indivisible, et le dit', () => {
    const document = ['# Doc', `## Huge\n\n${'A'.repeat(500)}`].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 200 });

    expect(plan.packs).toHaveLength(1);
    expect(plan.packs[0]!.truncated).toBe(true);
    expect(plan.packs[0]!.reason).toBe('atomic');
    expect(plan.packs[0]!.chars).toBeLessThanOrEqual(200);
    expect(plan.packs[0]!.text).toContain('[section truncated]');
    expect(plan.diagnostics.truncatedBlocks).toBe(1);
  });

  it('publie de quoi expliquer chaque coupe', () => {
    const document = ['# Doc', ...Array.from({ length: 6 }, (_, index) =>
      `## S${index}\n\n${filler(12)}`)].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 2500 });

    expect(plan.diagnostics.normalizedChars).toBe(document.length);
    expect(plan.diagnostics.headings).toBe(6);
    expect(plan.diagnostics.packs).toBe(plan.packs.length);
    expect(plan.diagnostics.packChars).toEqual(chars(plan));
    expect(plan.diagnostics.maxChars).toBe(2500);
    expect(Object.values(plan.diagnostics.reasons).reduce((a, b) => a + b, 0)).toBe(plan.packs.length);
  });

  it('mesure l’Unicode comme l’exécution le mesurera', () => {
    // Le diagnostic et l'exécution doivent compter la même chose : un accent ou
    // un emoji ne doit pas faire diverger l'estimation de la réalité.
    const document = ['# Café', `## Été\n\n${'é'.repeat(400)}`].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 300 });

    for (const pack of plan.packs) {
      expect(pack.chars).toBe(pack.text.length);
      expect(pack.chars).toBeLessThanOrEqual(300);
    }
  });
});

describe('cohérence entre l’estimation et l’exécution', () => {
  it('planifie le même nombre de lots des deux côtés, sur le corps normalisé', () => {
    /*
     `wiki doctor` lit un fichier brut ; l'ingestion retire le frontmatter puis
     passe par `normalizeSourceBody`, qui déplie le HTML exporté. L'écart n'est
     pas marginal : un export Confluence de 56 817 caractères retombe à 19 838,
     et planifier sur le brut annonçait neuf appels pour une source qui en coûte
     quatre. Une estimation que l'exécution ne tient pas est pire que pas
     d'estimation.
    */
    const html = Array.from({ length: 40 }, (_, index) =>
      `<p><span class="x"><strong>Point ${index}</strong> ${sentence}</span></p>`).join('\n');
    const file = `---\ntitle: Export\n---\n\n# Export\n\n## Détail\n\n${html}\n`;

    const rawPlan = planSourcePacks(file, { maxChars: 2000 });
    const ingestPlan = planSourcePacks(
      normalizeSourceBody(matter(file).content.trim()),
      { maxChars: 2000 },
    );

    expect(ingestPlan.diagnostics.normalizedChars).toBeLessThan(rawPlan.diagnostics.normalizedChars);
    expect(ingestPlan.packs.length).toBeLessThan(rawPlan.packs.length);

    // Le contrat : c'est le corps normalisé qui doit être planifié des deux
    // côtés, et deux appels sur cette même entrée rendent le même plan.
    expect(planSourcePacks(
      normalizeSourceBody(matter(file).content.trim()),
      { maxChars: 2000 },
    ).packs.map((pack) => pack.text)).toEqual(ingestPlan.packs.map((pack) => pack.text));
  });
});

describe('compatibilité du point d’entrée historique', () => {
  it('splitSourceSections rend exactement les textes du plan', () => {
    const document = ['# Doc', `## A\n\n${filler(20)}`, `## B\n\n${filler(20)}`].join('\n\n');

    const plan = planSourcePacks(document, { maxChars: 900 });
    expect(splitSourceSections(document, 900)).toEqual(plan.packs.map((pack) => pack.text));
  });

  it('rend le titre seul pour un document sans corps', () => {
    expect(splitSourceSections('# Titre seul', 100)).toEqual(['# Titre seul']);
    expect(splitSourceSections('', 100)).toEqual([]);
  });
});
