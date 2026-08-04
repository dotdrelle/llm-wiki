/**
 * Résumé de contexte d'une page du wiki, pour la fiche flottante du graphe.
 *
 * Le lecteur qui clique sur une page isolée ne veut pas la lire en entier : il
 * veut savoir de quoi elle parle avant de décider d'y aller. Trois lignes
 * suffisent, mais elles doivent être une synthèse — un premier paragraphe
 * arraché au fichier dit ce qu'il y a en haut de la page, pas ce qu'elle
 * contient.
 *
 * Le résumé est donc produit par le LLM configuré et mis en cache sur disque,
 * indexé par l'empreinte du fichier : une page inchangée n'est résumée qu'une
 * fois, et un ingest qui la réécrit invalide l'entrée sans qu'on ait à purger
 * quoi que ce soit. Sans LLM configuré, ou s'il échoue, on rend l'extrait —
 * moins bon, mais jamais rien.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type GraphDocumentSummary = {
  id: string;
  title: string;
  summary: string;
  source: 'llm' | 'excerpt';
};

type CacheEntry = { contentEtag: string; summary: string };
type CacheFile = Record<string, CacheEntry>;

const SUMMARY_SYSTEM = [
  'You summarize a single page of a personal knowledge wiki.',
  'Answer with 2 to 4 short sentences of plain prose, no heading, no bullet list, no preamble.',
  'Say what the page is about and what a reader would find in it.',
  'Write in the same language as the page itself.',
].join(' ');

function cachePath(rootDir: string): string {
  return path.join(rootDir, '.wiki', 'cache', 'graph-summaries.json');
}

async function readCache(rootDir: string): Promise<CacheFile> {
  try {
    const raw = await readFile(cachePath(rootDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CacheFile) : {};
  } catch {
    // Cache absent ou illisible : ce n'est pas une erreur, seulement un coût.
    return {};
  }
}

async function writeCache(rootDir: string, cache: CacheFile): Promise<void> {
  try {
    const file = cachePath(rootDir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cache), 'utf8');
  } catch {
    // Un cache non écrit se recalculera : jamais de quoi faire échouer la
    // requête qui l'a produit.
  }
}

/**
 * Extrait de repli : premières phrases du texte déjà nettoyé par
 * `markdownPreviewForGraph` (frontmatter, blocs de code et balisage retirés).
 */
export function excerptSummary(preview: string): string {
  const text = String(preview ?? '').trim();
  if (!text) return 'This page has no readable content yet.';
  // Chaque capture emporte l'espace qui la précède : les recoller tels quels
  // doublerait les blancs entre les phrases.
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim());
  const joined = (sentences ? sentences.slice(0, 3).join(' ') : text).trim();
  return joined.length > 420 ? `${joined.slice(0, 417).trimEnd()}…` : joined;
}

export async function graphDocumentSummary(options: {
  rootDir: string;
  id: string;
  title: string;
  preview: string;
  contentEtag: string;
  complete?: (request: { system: string; user: string }) => Promise<string>;
}): Promise<GraphDocumentSummary> {
  const { rootDir, id, title, preview, contentEtag, complete } = options;
  const base = { id, title };
  if (!complete) return { ...base, summary: excerptSummary(preview), source: 'excerpt' };

  const cache = await readCache(rootDir);
  const hit = cache[id];
  if (hit?.contentEtag === contentEtag && hit.summary) {
    return { ...base, summary: hit.summary, source: 'llm' };
  }

  try {
    const answer = (
      await complete({
        system: SUMMARY_SYSTEM,
        user: `Page: ${title}\nPath: ${id}\n\n---\n${preview}\n---`,
      })
    ).trim();
    if (!answer) return { ...base, summary: excerptSummary(preview), source: 'excerpt' };
    cache[id] = { contentEtag, summary: answer };
    await writeCache(rootDir, cache);
    return { ...base, summary: answer, source: 'llm' };
  } catch {
    // Provider injoignable, quota, modèle absent : la fiche s'ouvre quand même.
    return { ...base, summary: excerptSummary(preview), source: 'excerpt' };
  }
}
