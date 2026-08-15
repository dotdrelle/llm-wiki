import matter from 'gray-matter';
import { EXTRACTION_SCOPES, type ExtractionScope } from './extractionSchema.ts';

/*
 Provenance canonique d'une page : sujet, collection, portée.

 Le classement s'appuyait jusqu'ici sur `group:`, une chaîne libre écrite par le
 modèle. Sur un corpus comparatif, cela produisait l'inverse de ce qu'on
 cherche : cinq produits différents rassemblés sous `security`, et les pages d'un
 même produit dispersées entre `software`, `feature` et `integration`. La
 provenance ne peut pas être déduite d'une étiquette dont personne ne contrôle le
 vocabulaire.

 Ces trois champs sont donc structurés, normalisés et validés. Ils ne remplacent
 pas `group:` — qui reste un signal de classement libre — ils lui retirent la
 charge de prouver une identité.

 Aucune liste de produits, de fournisseurs ou de domaines n'est codée ici : la
 normalisation ne fait que canoniser la forme de ce que la source a dit.
*/

export type PageProvenance = {
  subject: string | null;
  collection: string | null;
  scope: ExtractionScope | null;
};

/**
 * Forme canonique d'une valeur de provenance.
 *
 * Minuscules, accents retirés, séparateurs unifiés : `Anaplan`, `anaplan` et
 * `Anaplan ` doivent désigner le même sujet, sinon l'identité qu'on vient
 * d'introduire souffrirait exactement du défaut de `group:`.
 */
export function normalizeProvenanceValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isValidProvenanceValue(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

export function isExtractionScope(value: unknown): value is ExtractionScope {
  return typeof value === 'string' && (EXTRACTION_SCOPES as readonly string[]).includes(value);
}

/**
 * Injecte la provenance dans le frontmatter d'un contenu de page.
 *
 * L'injection est faite par le MOTEUR, pas confiée au modèle. Demander à un LLM
 * d'écrire trois champs exacts dans chaque page qu'il produit, c'est accepter
 * qu'ils manquent sur une page sur dix — et une provenance présente neuf fois
 * sur dix ne vaut pas mieux qu'une provenance absente : elle rend le classement
 * incohérent au lieu de le rendre incomplet.
 *
 * Une valeur déjà présente dans le fichier et non fournie ici est conservée :
 * une modification manuelle explicite prime sur la projection automatique.
 */
export function applyProvenance(content: string, provenance: PageProvenance): string {
  const parsed = matter(content);
  const data: Record<string, unknown> = { ...parsed.data };

  for (const [key, value] of Object.entries(provenance)) {
    if (value == null) continue;
    data[key] = value;
  }

  if (!Object.keys(data).length) return content;
  return matter.stringify(parsed.content, data);
}

/**
 * Lit la provenance d'une page existante.
 *
 * Une valeur mal formée est traitée comme absente plutôt que réparée : la
 * réparer en silence ferait entrer dans le classement une identité que personne
 * n'a validée.
 */
export function readProvenance(content: string): PageProvenance {
  const { data } = matter(content);
  const read = (key: 'subject' | 'collection'): string | null => {
    const value = data[key];
    return typeof value === 'string' && isValidProvenanceValue(value) ? value : null;
  };
  return {
    subject: read('subject'),
    collection: read('collection'),
    scope: isExtractionScope(data.scope) ? data.scope : null,
  };
}

/**
 * Provenance d'une source, telle que le moteur la déduit sans rien inventer.
 *
 * La collection vient de la STRUCTURE de la source — le répertoire qui réunit
 * des documents frères — parce que c'est le seul signal disponible avant toute
 * décision du modèle. Le sujet, lui, n'est pas déduit du chemin : un nom de
 * fichier est un accident d'export, et le promouvoir en identité rouvrirait la
 * porte que `group:` laissait ouverte. Il est proposé par la consolidation, qui
 * a lu le document.
 */
export function collectionFromSourcePath(relativePath: string): string | null {
  const parts = relativePath.split('/').filter(Boolean);
  // La collection est le parent IMMÉDIAT du document, pas la première racine
  // d'export. Sur ACPI, `Outils de gestion` contient plusieurs ensembles sans
  // rapport ; les cinq produits sont frères sous `Synthèse Solutions externes`.
  // Prendre le premier segment après `untracked` les aurait tous classés dans
  // une collection beaucoup trop large.
  const index = parts.findIndex((part) => part === 'untracked' || part === 'ingested');
  if (index < 0 || parts.length - index < 3) return null;
  const parentIndex = parts.length - 2;
  if (parentIndex <= index) return null;
  const folder = normalizeProvenanceValue(parts[parentIndex]!);
  return folder && isValidProvenanceValue(folder) ? folder : null;
}
