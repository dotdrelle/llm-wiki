/*
 Schéma du registre de taxonomie — vocabulaire inspiré de SKOS.

 Le registre reprend les noms de champs et quelques règles d'un thésaurus
 (`prefLabel` indexé par langue, `altLabel`, `scopeNote`) sans prétendre être un
 modèle SKOS complet : `replaces`, `replacedBy`, `deprecated`, `changeNote` et
 `primaryCommunity` sont des extensions locales, et l'unicité du libellé visible
 est une contrainte de la carte, pas du standard.

 Rien de tout cela ne sort d'ici : le snapshot expose toujours `label` en
 chaîne, dérivé au moment de la lecture.
*/

/** Version du schéma. Un registre d'une autre version est ignoré, jamais réinterprété. */
export const REGISTRY_SCHEMA_VERSION = 2;

/**
 * Profondeur maximale de l'arborescence : domaine → communauté → pages.
 *
 * La navigation du graphe est `carte → domaine → communauté → document`. Un
 * troisième niveau de communauté n'aurait aucun rendu et rendrait la carte
 * illisible avant d'être utile ; il s'ajoutera le jour où un écran l'exprimera.
 */
export const MAX_COMMUNITY_DEPTH = 2;

export type LocalizedText = Record<string, string>;
export type LocalizedList = Record<string, string[]>;

export type RegistryCommunity = {
  id: string;
  /**
   * Domaine parent, ou `null`/absent pour un domaine racine.
   *
   * La v1 était plate, et c'est ce qui a produit un fourre-tout : le modèle
   * n'avait aucun moyen d'exprimer « ces cinq produits sont cinq sujets
   * distincts qui relèvent du même domaine ». Réduire le nombre de bulles ne
   * pouvait donc qu'agglomérer, et agglomérer détruit la navigation.
   */
  parentCommunity?: string | null;
  /** Au plus une valeur par langue. C'est ce qui rend un changement de langue bon marché. */
  prefLabel: LocalizedText;
  altLabel?: LocalizedList;
  scopeNote?: LocalizedText;
  /** Concepts absorbés par celui-ci. Extension locale. */
  replaces?: string[];
  /** Renseigné quand CE concept a été absorbé. L'entrée n'est jamais supprimée. */
  replacedBy?: string | null;
  deprecated?: boolean;
  firstSeenRevision: number;
  changeNote?: Array<{ revision: number; kind: string; from?: string[] }>;
};

export type RegistryAssignment = {
  /**
   * Communauté d'appartenance, obligatoirement une **feuille**.
   *
   * Une page n'est jamais rattachée directement à un domaine : le domaine
   * agrège ses feuilles, il ne les remplace pas. C'est ce qui garantit qu'un
   * clic sur un domaine ouvre ses communautés et non une liste de 142
   * documents.
   */
  primaryCommunity: string;
  /**
   * Facettes secondaires, avec une sémantique explicite : « relié à », jamais
   * « appartient à ».
   *
   * Une page « sécurité Prophix » relève principalement de Prophix ; la ranger
   * dans Sécurité la ferait disparaître de son produit, et la dupliquer
   * fausserait tous les comptes. Ces liens ne pilotent donc aucun placement :
   * ils enrichissent la lecture et la recherche.
   */
  relatedCommunities?: string[];
};

export type TaxonomyRegistry = {
  schemaVersion: number;
  revision: number;
  corpus: string;
  languages: string[];
  communities: RegistryCommunity[];
  /** Chemin de page relatif au workspace → affectation. */
  assignments: Record<string, RegistryAssignment>;
};

export type ValidationIssue = { path: string; reason: string };
export type ValidationResult =
  | { ok: true; registry: TaxonomyRegistry }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Forme normalisée d'un libellé pour la comparaison d'unicité.
 *
 * `Solution`, `solution` et `Sólution` sont le même mot à l'écran d'un lecteur ;
 * les traiter comme distincts laisserait passer exactement le doublon que D7
 * interdit.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Un libellé visible est un mot unique, sans chemin.
 *
 * La contrainte vient du rendu : une bulle porte un mot, pas un syntagme ni un
 * chemin. `/` et `_` sont exclus explicitement parce que ce sont les deux
 * façons dont un modèle recrache une hiérarchie de dossiers en guise de nom.
 */
export function isValidLabel(label: string): boolean {
  if (typeof label !== 'string') return false;
  const trimmed = label.trim();
  if (!trimmed || trimmed !== label) return false;
  if (/[\s/_\\]/.test(trimmed)) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateLocalizedText(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { labels = false }: { labels?: boolean } = {},
): void {
  if (!isPlainObject(value)) {
    issues.push({ path, reason: 'attendu : objet indexé par langue' });
    return;
  }
  for (const [language, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !text.trim()) {
      issues.push({ path: `${path}.${language}`, reason: 'texte vide ou non textuel' });
      continue;
    }
    if (labels && !isValidLabel(text)) {
      issues.push({ path: `${path}.${language}`, reason: `libellé invalide : « ${text} »` });
    }
  }
}

/**
 * Valide un registre **en bloc**.
 *
 * Une proposition non conforme est rejetée entière, jamais réparée en silence
 * ni appliquée partiellement : un registre à moitié appliqué produirait une
 * carte que personne n'a décidée, et dont on ne saurait plus dire de quoi elle
 * dérive.
 */
export function validateRegistry(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: '', reason: 'registre absent ou non objet' }] };
  }

  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    // Un registre d'une autre version est ignoré, pas réinterprété : deviner la
    // sémantique d'un format inconnu est la façon la plus sûre de corrompre.
    return {
      ok: false,
      issues: [{ path: 'schemaVersion', reason: `attendu ${REGISTRY_SCHEMA_VERSION}, reçu ${String(value.schemaVersion)}` }],
    };
  }
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0) {
    issues.push({ path: 'revision', reason: 'entier positif attendu' });
  }
  if (typeof value.corpus !== 'string' || !value.corpus) {
    issues.push({ path: 'corpus', reason: 'empreinte de corpus manquante' });
  }
  if (!Array.isArray(value.languages) || value.languages.some((item) => typeof item !== 'string')) {
    issues.push({ path: 'languages', reason: 'liste de langues attendue' });
  }
  if (!Array.isArray(value.communities)) {
    issues.push({ path: 'communities', reason: 'liste attendue' });
    return { ok: false, issues };
  }

  const ids = new Set<string>();
  /*
   Unicité du libellé visible, par langue et **par fratrie**.

   La v1 imposait l'unicité globale, parce qu'une carte plate affiche tout en
   même temps. Une arborescence ne montre jamais que les racines, puis les
   enfants d'un seul domaine : deux « Reporting » sous deux domaines distincts
   ne se rencontrent donc jamais à l'écran. Garder la règle globale
   interdirait des noms parfaitement légitimes et repousserait le modèle vers
   des libellés composés — c'est-à-dire vers ce que la règle du mot unique
   cherche à éviter.

   Les racines sont fratrie entre elles, sous la clé vide.
  */
  const labelsBySibling = new Map<string, Map<string, string>>();
  const parentOf = new Map<string, string | null>();

  for (const [index, community] of value.communities.entries()) {
    const at = `communities[${index}]`;
    if (!isPlainObject(community)) {
      issues.push({ path: at, reason: 'objet attendu' });
      continue;
    }
    const id = community.id;
    if (typeof id !== 'string' || !id) {
      issues.push({ path: `${at}.id`, reason: 'identifiant manquant' });
    } else if (ids.has(id)) {
      issues.push({ path: `${at}.id`, reason: `identifiant en double : ${id}` });
    } else {
      ids.add(id);
    }

    validateLocalizedText(community.prefLabel, `${at}.prefLabel`, issues, { labels: true });
    if (community.altLabel !== undefined) {
      if (!isPlainObject(community.altLabel)) {
        issues.push({ path: `${at}.altLabel`, reason: 'objet indexé par langue attendu' });
      } else {
        for (const [language, list] of Object.entries(community.altLabel)) {
          if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
            issues.push({ path: `${at}.altLabel.${language}`, reason: 'liste de chaînes attendue' });
          }
        }
      }
    }
    if (community.scopeNote !== undefined) {
      validateLocalizedText(community.scopeNote, `${at}.scopeNote`, issues);
    }
    if (typeof community.firstSeenRevision !== 'number') {
      issues.push({ path: `${at}.firstSeenRevision`, reason: 'révision d’apparition manquante' });
    }

    /*
     Un concept déprécié SANS remplaçant est légitime.

     La règle exigeait un successeur, au motif qu'une sélection restaurée n'aurait
     « plus où aller ». C'est faux : `resolveCommunity` s'arrête sur un
     `replacedBy` nul et rend le concept déprécié lui-même, que le client sait
     présenter comme disparu.

     Exiger un successeur avait en revanche une conséquence bien réelle : quand
     aucune communauté survivante ne reprenait les pages, il fallait bien en
     inventer un, et le code se repliait sur le premier de la liste. Un lecteur
     qui revenait avec un identifiant ancien atterrissait donc en silence dans
     une communauté sans rapport. Une redirection fausse est pire qu'une absence
     de redirection : la seconde se voit, la première non.
    */
    const deprecated = community.deprecated === true;
    const parent = community.parentCommunity == null ? null : String(community.parentCommunity);
    if (typeof id === 'string' && id) parentOf.set(id, parent);
    if (!deprecated && isPlainObject(community.prefLabel)) {
      for (const [language, text] of Object.entries(community.prefLabel)) {
        if (typeof text !== 'string') continue;
        const scope = `${language}\u001f${parent ?? ''}`;
        const seen = labelsBySibling.get(scope) ?? new Map<string, string>();
        const key = normalizeLabel(text);
        const owner = seen.get(key);
        if (owner && owner !== id) {
          issues.push({
            path: `${at}.prefLabel.${language}`,
            reason: `libellé visible en double avec ${owner} dans la même fratrie : « ${text} »`,
          });
        }
        seen.set(key, typeof id === 'string' ? id : at);
        labelsBySibling.set(scope, seen);
      }
    }
  }

  // Arborescence : parent connu ET vivant, aucun cycle, profondeur bornée.
  const deprecatedIds = new Set(
    value.communities
      .filter((community): community is Record<string, unknown> => isPlainObject(community))
      .filter((community) => community.deprecated === true && typeof community.id === 'string')
      .map((community) => String(community.id)),
  );
  const childCount = new Map<string, number>();
  for (const [index, community] of value.communities.entries()) {
    if (!isPlainObject(community)) continue;
    const at = `communities[${index}]`;
    const id = typeof community.id === 'string' ? community.id : null;
    const parent = community.parentCommunity == null ? null : String(community.parentCommunity);
    if (!parent) continue;
    if (!ids.has(parent)) {
      issues.push({ path: `${at}.parentCommunity`, reason: `domaine parent inconnu : ${parent}` });
      continue;
    }
    if (parent === id) {
      issues.push({ path: `${at}.parentCommunity`, reason: 'une communauté ne peut pas être son propre parent' });
      continue;
    }
    /*
     Une communauté active ne pend pas à un parent mort.

     Le parent existait bien dans le registre — la règle ci-dessus était donc
     satisfaite — mais il pouvait être déprécié. Or `communityHierarchy` ne
     construit l'arbre qu'à partir des communautés ACTIVES : l'enfant sortait
     alors de la hiérarchie et remontait comme bulle racine sur la carte, en
     contredisant ce que le registre déclarait. Un registre valide ne doit pas
     pouvoir décrire deux arbres différents selon qui le lit.
    */
    if (community.deprecated !== true && deprecatedIds.has(parent)) {
      issues.push({ path: `${at}.parentCommunity`, reason: `domaine parent déprécié : ${parent}` });
      continue;
    }
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);

    // Remontée bornée : un cycle rendrait la profondeur infinie et ferait
    // boucler tout consommateur qui remonte l'arbre — carte comprise.
    let depth = 1;
    let cursor = parent;
    const seenAncestors = new Set<string>([id ?? at]);
    while (cursor) {
      if (seenAncestors.has(cursor)) {
        issues.push({ path: `${at}.parentCommunity`, reason: `cycle de parenté via ${cursor}` });
        depth = Number.POSITIVE_INFINITY;
        break;
      }
      seenAncestors.add(cursor);
      const next = parentOf.get(cursor) ?? null;
      if (!next) break;
      cursor = next;
      depth += 1;
    }
    if (depth > MAX_COMMUNITY_DEPTH - 1) {
      issues.push({
        path: `${at}.parentCommunity`,
        reason: `profondeur ${depth + 1} au-delà du maximum ${MAX_COMMUNITY_DEPTH}`,
      });
    }
  }

  for (const [index, community] of value.communities.entries()) {
    if (!isPlainObject(community)) continue;
    const at = `communities[${index}]`;
    const replacedBy = community.replacedBy;
    if (replacedBy != null && !ids.has(String(replacedBy))) {
      issues.push({ path: `${at}.replacedBy`, reason: `cible inconnue : ${String(replacedBy)}` });
    }
    if (community.replaces !== undefined) {
      if (!Array.isArray(community.replaces)) {
        issues.push({ path: `${at}.replaces`, reason: 'liste attendue' });
      } else {
        for (const target of community.replaces) {
          if (!ids.has(String(target))) {
            issues.push({ path: `${at}.replaces`, reason: `concept absorbé inconnu : ${String(target)}` });
          }
        }
      }
    }
  }

  if (!isPlainObject(value.assignments)) {
    issues.push({ path: 'assignments', reason: 'objet attendu' });
  } else {
    const active = new Set(
      value.communities
        .filter((community) => isPlainObject(community) && community.deprecated !== true)
        .map((community) => String((community as Record<string, unknown>).id)),
    );
    for (const [page, assignment] of Object.entries(value.assignments)) {
      /*
       Une page se rattache à une FEUILLE, jamais à un domaine.

       C'est l'invariant qui empêche le fourre-tout : un domaine agrège ses
       communautés, il ne les remplace pas. Autoriser l'attache directe
       rouvrirait exactement la porte par laquelle 142 pages se sont
       retrouvées dans une seule bulle, et un clic sur le domaine afficherait
       de nouveau une liste que personne ne peut lire.
      */
      if (isPlainObject(assignment)
        && typeof assignment.primaryCommunity === 'string'
        && (childCount.get(assignment.primaryCommunity) ?? 0) > 0) {
        issues.push({
          path: `assignments["${page}"].primaryCommunity`,
          reason: `rattachement à un domaine parent : ${assignment.primaryCommunity} porte des communautés filles`,
        });
      }
      if (isPlainObject(assignment) && assignment.relatedCommunities !== undefined) {
        const related = assignment.relatedCommunities;
        if (!Array.isArray(related)) {
          issues.push({ path: `assignments["${page}"].relatedCommunities`, reason: 'liste attendue' });
        } else {
          for (const target of related) {
            if (!active.has(String(target))) {
              issues.push({
                path: `assignments["${page}"].relatedCommunities`,
                reason: `communauté inconnue ou dépréciée : ${String(target)}`,
              });
            } else if (String(target) === assignment.primaryCommunity) {
              // Une facette qui répète l'appartenance principale n'ajoute rien
              // et fausserait tout comptage qui additionne les deux.
              issues.push({
                path: `assignments["${page}"].relatedCommunities`,
                reason: `facette redondante avec primaryCommunity : ${String(target)}`,
              });
            }
          }
        }
      }
      if (!isPlainObject(assignment) || typeof assignment.primaryCommunity !== 'string') {
        issues.push({ path: `assignments["${page}"]`, reason: 'primaryCommunity manquant' });
        continue;
      }
      if (!active.has(assignment.primaryCommunity)) {
        // Affecter une page à un concept absorbé la ferait disparaître de la
        // carte sans que rien ne le signale.
        issues.push({
          path: `assignments["${page}"].primaryCommunity`,
          reason: `communauté inconnue ou dépréciée : ${assignment.primaryCommunity}`,
        });
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, registry: value as unknown as TaxonomyRegistry };
}

/**
 * Libellé à afficher pour une communauté, dans la langue voulue.
 *
 * C'est le seul point où le vocabulaire du registre redevient la chaîne que le
 * snapshot expose. La langue configurée d'abord, puis un repli, puis
 * l'identifiant — jamais rien de vide.
 */
export function communityLabel(
  community: RegistryCommunity,
  language: string,
  fallbackLanguage = 'en',
): string {
  return (
    community.prefLabel[language]
    ?? community.prefLabel[fallbackLanguage]
    ?? Object.values(community.prefLabel)[0]
    ?? community.id
  );
}

/** Suit les absorptions jusqu'au concept actif, en bornant les cycles. */
export function resolveCommunity(
  registry: TaxonomyRegistry,
  id: string,
): RegistryCommunity | null {
  const byId = new Map(registry.communities.map((community) => [community.id, community]));
  let current = byId.get(id) ?? null;
  for (let hops = 0; current?.deprecated && current.replacedBy && hops < 16; hops += 1) {
    current = byId.get(current.replacedBy) ?? null;
  }
  return current ?? null;
}
