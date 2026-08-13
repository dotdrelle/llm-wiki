import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalize, contentHash } from '../src/graph/wiki/taxonomy/canonical.ts';

describe('sérialisation canonique du registre', () => {
  /*
   La propriété qui porte tout le reste : la génération est adressée par son
   contenu et le marqueur vérifie cette empreinte. Deux producteurs calculant
   la même taxonomie par des chemins de code différents — donc dans un ordre de
   clés différent — doivent converger sur le même fichier.
  */
  it('rend l’ordre d’insertion des clés sans effet', () => {
    const a = { id: 'cmty_1', prefLabel: { fr: 'Solution', en: 'Solution' }, deprecated: false };
    const b = { deprecated: false, prefLabel: { en: 'Solution', fr: 'Solution' }, id: 'cmty_1' };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(contentHash(canonicalJson(a))).toBe(contentHash(canonicalJson(b)));
  });

  it('préserve l’ordre des tableaux, qui est porteur de sens', () => {
    // `replaces` et `changeNote` racontent une chronologie : les trier
    // effacerait l'information qu'ils transportent.
    const forward = canonicalJson({ replaces: ['cmty_9F', 'cmty_A2'] });
    const backward = canonicalJson({ replaces: ['cmty_A2', 'cmty_9F'] });

    expect(forward).not.toBe(backward);
    expect(forward).toContain('["cmty_9F","cmty_A2"]');
  });

  it('trie en profondeur, pas seulement à la racine', () => {
    const nested = canonicalJson({ communities: [{ z: 1, a: { y: 2, b: 3 } }] });

    expect(nested).toBe('{"communities":[{"a":{"b":3,"y":2},"z":1}]}');
  });

  it('produit des octets compacts, sans indentation ni espace', () => {
    const json = canonicalJson({ revision: 42, corpus: 'sha1:abc' });

    expect(json).toBe('{"corpus":"sha1:abc","revision":42}');
    expect(json).not.toContain('\n');
  });

  /*
   `undefined` disparaît de la sortie JSON. Deux registres de formes
   différentes — l'un avec la clé absente, l'autre avec la clé à `undefined` —
   donneraient donc la même empreinte tout en étant deux objets distincts en
   mémoire. On normalise plutôt que de laisser la coïncidence décider.
  */
  it('normalise une clé indéfinie sur une clé absente', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('refuse un nombre non représentable plutôt que d’écrire null', () => {
    // JSON.stringify(NaN) donne "null" : l'empreinte serait stable mais le
    // contenu relu ne vaudrait plus l'original.
    expect(() => canonicalJson({ score: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ score: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('laisse passer null, qui est une valeur JSON légitime', () => {
    // `replacedBy: null` signifie « ce concept n'a pas été absorbé ».
    expect(canonicalJson({ replacedBy: null })).toBe('{"replacedBy":null}');
    expect(canonicalize(null)).toBeNull();
  });

  it('donne une empreinte stable, courte et sensible au moindre écart', () => {
    const hash = contentHash(canonicalJson({ id: 'cmty_1' }));

    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toBe(contentHash(canonicalJson({ id: 'cmty_1' })));
    expect(hash).not.toBe(contentHash(canonicalJson({ id: 'cmty_2' })));
  });
});
