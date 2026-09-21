import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashText } from '../utils/hash.ts';
import { extractBodyCitations, isRawIngestedPath, isWikiPagePath } from './derive.ts';
import { resolveAnchor } from './locators.ts';

/*
 * Lot 4 of `plan-provenance-feuilles.md`: the transitive resolver and the
 * per-build evidence manifest.
 *
 * The resolver follows `livrable → wiki/concepts → wiki/sources → raw/ingested`
 * one section at a time, bounded in depth and cycle-safe, and returns only the
 * terminal fragments. An invalid or missing anchor is a degradation, never a
 * silent widening to the whole file.
 *
 * The manifest stores the exact fragment TEXT a build used, so an export run
 * after the archive was replaced still resolves A-v1 instead of A-v2.
 */

export interface EvidenceFragment {
  /** Terminal `raw/…` path. */
  path: string;
  /** Materialized anchor (empty for a legacy whole-file citation). */
  anchor: string;
  hash: string;
  text: string;
  /** Wiki pages followed to reach this fragment, in order. */
  chain: string[];
}

export interface EvidenceResolution {
  fragments: EvidenceFragment[];
  degradations: string[];
}

export interface ResolveEvidenceOptions {
  content: string;
  /** Returns the content of any workspace-relative page or archive, or null. */
  loadDocument: (documentPath: string) => string | null;
  maxDepth?: number;
}

export function resolveEvidence(options: ResolveEvidenceOptions): EvidenceResolution {
  const maxDepth = options.maxDepth ?? 3;
  const fragments = new Map<string, EvidenceFragment>();
  const degradations = new Set<string>();
  const stack: string[] = [];

  const visit = (content: string, chain: string[], depth: number): void => {
    for (const citation of extractBodyCitations(content)) {
      const documentPath = citation.path;
      const document = options.loadDocument(documentPath);
      if (document === null) {
        degradations.add(`missing document: ${documentPath}`);
        continue;
      }

      if (isRawIngestedPath(documentPath)) {
        let anchor = '';
        let text: string | null = null;
        if (citation.anchor) {
          const resolution = resolveAnchor(document, citation.anchor);
          if (resolution.status !== 'resolved') {
            degradations.add(`${resolution.status} anchor: ${documentPath}#${citation.anchor}`);
            continue;
          }
          anchor = citation.anchor;
          text = resolution.text;
        } else {
          // Legacy whole-file citation: readable, but not a precise proof.
          text = document;
          degradations.add(`unanchored citation (whole file): ${documentPath}`);
        }
        const key = `${documentPath}#${anchor}`;
        if (!fragments.has(key)) {
          fragments.set(key, { path: documentPath, anchor, hash: hashText(text), text, chain });
        }
        continue;
      }

      if (isWikiPagePath(documentPath)) {
        if (stack.includes(documentPath)) {
          degradations.add(`cycle: ${[...stack, documentPath].join(' -> ')}`);
          continue;
        }
        if (depth >= maxDepth) {
          degradations.add(`depth ceiling reached at ${documentPath}`);
          continue;
        }
        let sectionText = document;
        if (citation.anchor) {
          const resolution = resolveAnchor(document, citation.anchor);
          if (resolution.status !== 'resolved') {
            degradations.add(`${resolution.status} anchor: ${documentPath}#${citation.anchor}`);
            continue;
          }
          sectionText = resolution.text;
        }
        stack.push(documentPath);
        visit(sectionText, [...chain, documentPath], depth + 1);
        stack.pop();
        continue;
      }

      degradations.add(`unsupported citation target: ${documentPath}`);
    }
  };

  visit(options.content, [], 0);
  return { fragments: [...fragments.values()], degradations: [...degradations] };
}

export interface EvidenceManifestEntry {
  path: string;
  anchor: string;
  hash: string;
  text: string;
  chain: string[];
}

export interface EvidenceManifest {
  schemaVersion: 1;
  buildId: string;
  createdAt: string;
  fragments: EvidenceManifestEntry[];
}

export function createEvidenceManifest(
  buildId: string,
  fragments: EvidenceFragment[],
  now: string = new Date().toISOString(),
): EvidenceManifest {
  return {
    schemaVersion: 1,
    buildId,
    createdAt: now,
    fragments: fragments.map((fragment) => ({
      path: fragment.path,
      anchor: fragment.anchor,
      hash: fragment.hash,
      text: fragment.text,
      chain: [...fragment.chain],
    })),
  };
}

/**
 * The stored text wins: after A-v1 is replaced by A-v2, the export of the
 * first build still reads A-v1 from its manifest, never the current file.
 */
export function manifestFragment(
  manifest: EvidenceManifest,
  documentPath: string,
  anchor: string,
): EvidenceManifestEntry | null {
  return manifest.fragments.find((fragment) => fragment.path === documentPath && fragment.anchor === anchor) ?? null;
}

const SAFE_BUILD_ID = /^[a-zA-Z0-9._-]+$/;

export function evidenceManifestPath(rootDir: string, buildId: string): string {
  if (!SAFE_BUILD_ID.test(buildId)) throw new Error(`invalid build id: ${JSON.stringify(buildId)}`);
  return path.join(rootDir, '.wiki', 'builds', buildId, 'evidence.json');
}

export async function writeEvidenceManifest(rootDir: string, manifest: EvidenceManifest): Promise<string> {
  const target = evidenceManifestPath(rootDir, manifest.buildId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return target;
}

export async function readEvidenceManifest(rootDir: string, buildId: string): Promise<EvidenceManifest | null> {
  try {
    const raw = await readFile(evidenceManifestPath(rootDir, buildId), 'utf8');
    const parsed = JSON.parse(raw) as EvidenceManifest;
    return parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.fragments) ? parsed : null;
  } catch {
    return null;
  }
}
