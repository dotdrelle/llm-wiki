import { buildLocatorCatalogue, type LocatorCatalogue, materializeLocator } from './locators.ts';

/*
 * Ingest-side wiring of lot 1: the model is shown a bounded catalogue of
 * locator tokens it may copy (never invent), and its answer is post-processed
 * so every `#section:…` / `#fragment:…` token becomes the engineer-materialized
 * address (`#Heading > Sub` or `#L…@sha256=…`).
 */

export function renderLocatorCatalogueSection(catalogue: LocatorCatalogue): string {
  if (catalogue.locators.length === 0) return '';
  const lines = catalogue.locators.map((locator) => `- ${locator.token} — ${locator.preview}`);
  const truncated = catalogue.truncated ? '\n(the catalogue was truncated; cite only what is listed)' : '';
  return [
    '## Locators (cite ONLY these tokens, copied verbatim)',
    'A claim backed by a precise part of the document cites it as',
    '`[src: <archive path>#<locator>]`, using one of these tokens. Never write a line',
    'number, a byte offset or a hash yourself — the engine materializes those from the',
    'token you pick. When no locator covers a claim, keep the claim and cite the archive',
    'path alone.',
    ...lines,
  ].join('\n') + truncated;
}

export interface MaterializeResult {
  content: string;
  /** Tokens replaced by their terminal address. */
  materialized: number;
  /** Tokens that could not be resolved (document mismatch, absent locator). */
  unresolved: string[];
}

const TOKEN_PATTERN = /\[src:\s*([^\]#\s]+)#((?:section|fragment):[^\]]+)\]/g;

/**
 * Materialize catalogue tokens for ANY cited document, using a resolver the
 * caller provides. This is what a writer that is not the ingest — a curation
 * merge, `wiki_write_page` — must call, or the raw `#section:…` token would be
 * written into the wiki. Token-free citations are left untouched.
 */
export function materializeAllLocatorTokens(
  content: string,
  loadDocument: (documentPath: string) => string | null,
): MaterializeResult {
  const cache = new Map<string, string | null>();
  const unresolved: string[] = [];
  let materialized = 0;
  const next = String(content ?? '').replace(TOKEN_PATTERN, (match, path: string, token: string) => {
    if (!cache.has(path)) cache.set(path, loadDocument(path));
    const document = cache.get(path) ?? null;
    if (document === null) {
      unresolved.push(token);
      return match;
    }
    const address = materializeLocator(document, token);
    if (!address) {
      unresolved.push(token);
      return match;
    }
    materialized += 1;
    return `[src: ${path}#${address.anchor}]`;
  });
  return { content: next, materialized, unresolved };
}

/**
 * Replace `#section:…` / `#fragment:…` tokens with their terminal address, but
 * only for the document being ingested. Any other citation is left untouched,
 * so a legacy citation is never rewritten here.
 */
export function materializeLocatorTokens(
  content: string,
  options: { documentPath: string; documentContent: string },
): MaterializeResult {
  const unresolved: string[] = [];
  let materialized = 0;
  const next = String(content ?? '').replace(TOKEN_PATTERN, (match, path: string, token: string) => {
    if (path !== options.documentPath) return match;
    const address = materializeLocator(options.documentContent, token);
    if (!address) {
      unresolved.push(token);
      return match;
    }
    materialized += 1;
    return `[src: ${path}#${address.anchor}]`;
  });
  return { content: next, materialized, unresolved };
}

export { buildLocatorCatalogue };
