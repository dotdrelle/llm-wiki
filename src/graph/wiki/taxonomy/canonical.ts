import { createHash } from 'node:crypto';

/**
 * Sérialisation canonique du registre de taxonomie.
 *
 * Une génération est adressée par l'empreinte de son contenu, et le marqueur
 * qui la publie porte cette empreinte pour la vérifier. Les deux exigent que le
 * même registre produise toujours les mêmes octets :
 *
 * - deux producteurs qui calculent la même taxonomie doivent converger sur le
 *   même nom de fichier — c'est la déduplication naturelle et l'idempotence du
 *   rejeu ;
 * - relire une génération valide ne doit jamais échouer au contrôle
 *   d'intégrité parce qu'une autre version de Node a ordonné les clés
 *   autrement.
 *
 * `JSON.stringify` conserve l'ordre d'insertion des clés, qui dépend de l'ordre
 * de construction de l'objet : deux chemins de code produisant la même valeur
 * logique produisent des octets différents. On trie donc les clés
 * récursivement. L'ordre des tableaux, lui, est porteur de sens (une liste de
 * membres, un historique) et n'est jamais réordonné.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      // `undefined` disparaîtrait silencieusement de la sortie JSON : deux
      // objets de formes différentes donneraient alors la même empreinte. Le
      // schéma valide en amont, donc sa présence ici est un défaut d'appelant.
      if (entry === undefined) continue;
      sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('canonicalize: nombre non fini, non représentable en JSON');
  }
  return value;
}

/** Octets exacts qui seront écrits sur le disque — le hash porte sur eux. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Empreinte d'un contenu canonique, tronquée.
 *
 * Elle sert de nom de fichier et voyage dans le marqueur ; 32 caractères
 * hexadécimaux (128 bits) laissent une marge considérable face au nombre de
 * générations qu'un workspace produira jamais, tout en gardant un nom lisible
 * dans un `ls`.
 */
export function contentHash(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}
