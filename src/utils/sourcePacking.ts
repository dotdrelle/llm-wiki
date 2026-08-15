/*
 Empaquetage d'une source en lots d'ingestion.

 Le découpage précédent coupait à chaque `##`, puis à chaque `###` d'un bloc
 encore trop grand, et n'a jamais ré-empaqueté. La granularité produite dépendait
 donc de la mise en forme du document plutôt que de son volume : mesuré sur le
 corpus ACPI, Anaplan (14 868 caractères) donnait douze appels quand Board
 (19 838) en donnait cinq. Des documents éditorialement frères recevaient un
 nombre très différent de décisions LLM, et le déséquilibre de concepts qui en
 résultait était ensuite lu comme une différence de richesse.

 Le planificateur ci-dessous est PUR — même entrée, même plan — parce que
 `wiki doctor` doit annoncer exactement ce que l'ingestion exécutera. Deux
 estimations calculées autrement seraient pires que pas d'estimation du tout.
*/

/** Pourquoi ce lot existe : c'est ce que le diagnostic doit pouvoir expliquer. */
export type PackReason =
  /** La source entière tient en un seul lot. */
  | 'whole'
  /** Plusieurs sections adjacentes réunies jusqu'à la limite. */
  | 'packed'
  /** Une section `##` entière. */
  | 'section'
  /** Une sous-section `###` d'une section trop grande. */
  | 'subsection'
  /** Des paragraphes d'une sous-section encore trop grande. */
  | 'paragraph'
  /** Un bloc indivisible plus grand que la limite : tronqué, et dit. */
  | 'atomic';

export type SourcePack = {
  /** Texte exactement tel qu'il partira au prompt, préfixes compris. */
  text: string;
  chars: number;
  /** Chemin de titres couvert, du `#` du document au dernier titre inclus. */
  headingPath: string[];
  reason: PackReason;
  truncated: boolean;
};

export type SourcePackDiagnostics = {
  normalizedChars: number;
  headings: number;
  packs: number;
  packChars: number[];
  truncatedBlocks: number;
  reasons: Partial<Record<PackReason, number>>;
  maxChars: number;
  /** Budget consommé par l'enveloppe du prompt, hors texte de la source. */
  overhead: number;
};

export type SourcePackPlan = {
  packs: SourcePack[];
  diagnostics: SourcePackDiagnostics;
};

/**
 * Unité indivisible du plan : un corps, et les titres qui lui donnent son sens.
 *
 * Séparer les deux est ce qui permet à la fois de ré-empaqueter — plusieurs
 * unités dans un lot — et de conserver le contexte : une unité issue du milieu
 * d'une section reste précédée de ses titres, sans quoi le fragment envoyé au
 * modèle parlerait de rien.
 */
type Atom = {
  headingLines: string[];
  body: string;
  reason: Exclude<PackReason, 'whole' | 'packed'>;
};

const TRUNCATION_SUFFIX = '\n...[section truncated]';

/** Ouverture ou fermeture potentielle : le caractère et sa longueur. */
function fenceMarker(line: string): { char: '`' | '~'; length: number } | null {
  const match = /^(`{3,}|~{3,})/.exec(line.trim());
  return match ? { char: match[1]![0] as '`' | '~', length: match[1]!.length } : null;
}

/**
 * Suivi d'état des blocs de code, backticks **ou** tildes.
 *
 * CommonMark accepte les deux, et `~~~` est le recours habituel quand le bloc
 * contient lui-même des backticks — donc précisément dans les documents qui
 * citent du Markdown, ceux où un `##` d'exemple est le plus probable.
 *
 * Un bloc ne se referme que par le MÊME caractère, au moins aussi long : un
 * `~~~` rencontré dans un bloc ouvert par ``` est du contenu, et le compter
 * comme une clôture rouvrirait la porte qu'on vient de fermer.
 */
function createFenceTracker(): (line: string) => boolean {
  let open: { char: '`' | '~'; length: number } | null = null;
  return (line: string): boolean => {
    const marker = fenceMarker(line);
    if (!marker) return open !== null;
    if (!open) {
      open = marker;
      return true;
    }
    if (marker.char === open.char && marker.length >= open.length) open = null;
    return true;
  };
}

/**
 * Découpe à un niveau de titre, **hors blocs de code**.
 *
 * Un `## ` en première colonne d'un bloc `~~~` est du texte, pas un titre.
 * Couper dessus produisait un lot commençant au milieu d'un exemple et un autre
 * dont la clôture de bloc n'existait plus.
 */
function splitAtLevel(lines: string[], level: number): Array<{ heading: string | null; lines: string[] }> {
  const marker = `${'#'.repeat(level)} `;
  const blocks: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  const fenced = createFenceTracker();

  for (const line of lines) {
    if (fenced(line)) {
      current.lines.push(line);
      continue;
    }
    if (line.startsWith(marker)) {
      if (current.heading !== null || current.lines.some((item) => item.trim())) blocks.push(current);
      current = { heading: line.trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.heading !== null || current.lines.some((item) => item.trim())) blocks.push(current);
  return blocks;
}

/** Paragraphes séparés par une ligne vide, blocs de code gardés entiers. */
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const fenced = createFenceTracker();

  for (const line of text.split('\n')) {
    if (fenced(line)) {
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      if (current.length) paragraphs.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current.join('\n').trim());
  return paragraphs.filter(Boolean);
}

function render(titlePrefix: string, atoms: Atom[]): string {
  const parts: string[] = [];
  let emitted: string[] = [];
  for (const atom of atoms) {
    // Les titres déjà écrits par l'unité précédente ne sont pas répétés : le
    // budget doit payer le contexte une fois, pas une fois par paragraphe.
    const missing = atom.headingLines.filter((line, index) => emitted[index] !== line);
    if (missing.length) parts.push(missing.join('\n'));
    if (atom.body) parts.push(atom.body);
    emitted = atom.headingLines;
  }
  return `${titlePrefix}${parts.join('\n\n')}`.trim();
}

function truncate(body: string, budget: number): string {
  if (budget <= TRUNCATION_SUFFIX.length) return body.slice(0, Math.max(0, budget));
  return `${body.slice(0, budget - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
}

/**
 * Construit les unités d'une section, en descendant seulement si nécessaire.
 *
 * `##` d'abord, `###` seulement pour une section trop grande, paragraphes
 * seulement pour une sous-section encore trop grande. Descendre plus tôt
 * multiplierait les appels sans rien gagner ; descendre plus tard obligerait à
 * tronquer du texte parfaitement divisible.
 */
function atomsFor(
  headingLines: string[],
  lines: string[],
  fits: (atoms: Atom[]) => boolean,
  level: number,
  reason: Atom['reason'],
): Atom[] {
  const body = lines.join('\n').trim();
  const whole: Atom = { headingLines, body, reason };
  if (!body || fits([whole])) return [whole];

  if (level <= 6) {
    const blocks = splitAtLevel(lines, level);
    const headed = blocks.filter((block) => block.heading !== null);
    /*
     Un seul bloc titré fait quand même progresser la descente : son titre entre
     dans le contexte et le niveau suivant est examiné. Exiger deux blocs
     laissait une section unique trop grande tomber directement en découpe par
     paragraphes — qui séparait alors son propre titre de son corps.
    */
    if (headed.length > 0) {
      return blocks.flatMap((block) => atomsFor(
        block.heading ? [...headingLines, block.heading] : headingLines,
        block.lines,
        fits,
        level + 1,
        block.heading ? (level >= 3 ? 'subsection' : 'section') : reason,
      ));
    }
  }

  const paragraphs = splitParagraphs(body);
  if (paragraphs.length > 1) {
    return paragraphs.map((paragraph) => ({ headingLines, body: paragraph, reason: 'paragraph' }));
  }
  // Bloc réellement indivisible : la troncature est le dernier recours, et elle
  // est signalée plutôt que subie.
  return [{ headingLines, body, reason: 'atomic' }];
}

/**
 * Plan d'empaquetage d'une source.
 *
 * `maxChars` est la limite du texte envoyé ; `overhead` réserve ce que
 * l'enveloppe du prompt consomme déjà. Mesurer sur le texte rendu — préfixe de
 * titre et titres de contexte compris — est ce qui garantit que la limite
 * annoncée est celle qui s'applique.
 */
export function planSourcePacks(
  content: string,
  options: { maxChars: number; overhead?: number },
): SourcePackPlan {
  const overhead = Math.max(0, options.overhead ?? 0);
  const budget = Math.max(1, options.maxChars - overhead);

  const normalized = content.replace(/\r\n?/g, '\n').trim();
  const titleMatch = /^(# .+?)(?:\n|$)/.exec(normalized);
  const titlePrefix = titleMatch ? `${titleMatch[1]}\n\n` : '';
  const documentTitle = titleMatch ? titleMatch[1].replace(/^#\s+/, '').trim() : null;
  const body = titleMatch ? normalized.slice(titleMatch[0].length).trim() : normalized;

  // Compté hors blocs de code, comme la découpe elle-même : un diagnostic qui
  // compterait un `##` d'exemple annoncerait des coupes qui n'auront pas lieu.
  const headings = ((): number => {
    const fenced = createFenceTracker();
    let count = 0;
    for (const line of body.split('\n')) {
      if (!fenced(line) && /^#{1,6}\s+\S/.test(line)) count += 1;
    }
    return count;
  })();
  const diagnostics = (packs: SourcePack[]): SourcePackDiagnostics => ({
    normalizedChars: normalized.length,
    headings,
    packs: packs.length,
    packChars: packs.map((pack) => pack.chars),
    truncatedBlocks: packs.filter((pack) => pack.truncated).length,
    reasons: packs.reduce<Partial<Record<PackReason, number>>>((acc, pack) => {
      acc[pack.reason] = (acc[pack.reason] ?? 0) + 1;
      return acc;
    }, {}),
    maxChars: options.maxChars,
    overhead,
  });

  if (!body) {
    const packs: SourcePack[] = titlePrefix
      ? [{
          text: titlePrefix.trim(),
          chars: titlePrefix.trim().length,
          headingPath: documentTitle ? [documentTitle] : [],
          reason: 'whole',
          truncated: false,
        }]
      : [];
    return { packs, diagnostics: diagnostics(packs) };
  }

  const fits = (atoms: Atom[]): boolean => render(titlePrefix, atoms).length <= budget;
  const lines = body.split('\n');
  const atoms = atomsFor([], lines, fits, 2, 'section');

  const whole = render(titlePrefix, atoms);
  if (whole.length <= budget) {
    const packs: SourcePack[] = [{
      text: whole,
      chars: whole.length,
      headingPath: documentTitle ? [documentTitle] : [],
      reason: 'whole',
      truncated: false,
    }];
    return { packs, diagnostics: diagnostics(packs) };
  }

  /*
   Regroupement glouton des unités adjacentes.

   C'est la moitié qui manquait : sans elle, dix petites sections faisaient dix
   appels quand un seul suffisait, et le nombre d'appels devenait une propriété
   de la mise en forme.
  */
  const packs: SourcePack[] = [];
  let current: Atom[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = render(titlePrefix, current);
    /*
     Un lot ne dépasse la limite que s'il ne contenait qu'une unité qu'aucune
     coupe n'a pu réduire. Le tester sur la longueur plutôt que sur la raison
     est ce qui rend la garantie inconditionnelle : un paragraphe unique plus
     grand que le budget est aussi indivisible qu'un bloc de code, quel que soit
     le chemin qui l'a produit.
    */
    const truncated = text.length > budget;
    const finalText = truncated ? truncate(text, budget) : text;
    packs.push({
      text: finalText,
      chars: finalText.length,
      headingPath: [
        ...(documentTitle ? [documentTitle] : []),
        ...current[0]!.headingLines.map((line) => line.replace(/^#+\s+/, '')),
      ],
      reason: truncated ? 'atomic' : current.length > 1 ? 'packed' : current[0]!.reason,
      truncated,
    });
    current = [];
  };

  for (const atom of atoms) {
    if (!current.length) {
      current = [atom];
      // Une unité seule qui dépasse déjà est indivisible : elle part telle
      // quelle, tronquée si nécessaire, et n'attire personne avec elle.
      if (!fits(current)) flush();
      continue;
    }
    if (fits([...current, atom])) {
      current.push(atom);
      continue;
    }
    flush();
    current = [atom];
    if (!fits(current)) flush();
  }
  flush();

  return { packs, diagnostics: diagnostics(packs) };
}

/**
 * Vue « textes seuls » du plan.
 *
 * Une seule implémentation, deux lectures : l'ingestion, `wiki doctor` et les
 * tests historiques passent tous par le même planificateur. Un second chemin de
 * découpage rouvrirait l'écart entre ce qui est annoncé et ce qui est exécuté.
 */
export function splitSourceSections(content: string, maxChars: number): string[] {
  return planSourcePacks(content, { maxChars }).packs.map((pack) => pack.text);
}
