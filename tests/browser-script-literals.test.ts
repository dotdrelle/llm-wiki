import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function typescriptFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) return typescriptFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('scripts navigateur embarqués', () => {
  it('ne contiennent aucun accent grave qui fermerait leur littéral', () => {
    /*
     Ces scripts vivent dans des String.raw`…`. Un accent grave dans un
     commentaire — pour citer un nom de fonction, réflexe naturel en écrivant —
     ferme le littéral au milieu du script. Le message d'erreur qui en résulte
     pointe une ligne de prose française et parle de « module declaration
     names », ce qui n'oriente vers rien.

     Cela s'est produit trois fois de suite pendant l'écriture de ce module. Ce
     test le signale à l'endroit et sous le nom du vrai problème.
    */
    const offenders: string[] = [];
    for (const file of [...typescriptFiles('src/graph'), ...typescriptFiles('src/chat')]) {
      const source = readFileSync(file, 'utf8');
      const opener = source.indexOf('String.raw`');
      if (opener < 0) continue;
      const body = source.slice(opener + 'String.raw`'.length, source.lastIndexOf('`;'));
      body.split('\n').forEach((line, index) => {
        if (line.includes('`')) offenders.push(`${file}:${index + 1}  ${line.trim().slice(0, 70)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
