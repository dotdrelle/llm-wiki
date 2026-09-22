import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
  /**
   * Wiki pages followed, in order, WITH the anchor used at each hop. The
   * anchor is what preserves section granularity: a deliverable citing
   * `wiki/concepts/x.md#Costs` must only receive the fragments that section
   * actually used, not the whole page's closure.
   */
  chain: Array<{ path: string; anchor: string | null }>;
  /**
   * Every OTHER chain that reached the same terminal fragment. Two leaves can
   * cite the same proof; keying the manifest on the first chain alone dropped
   * the second leaf from the frozen map, so its export fell back to the live
   * file. Additive: a manifest written before this key simply has none.
   */
  extraChains: Array<Array<{ path: string; anchor: string | null }>>;
}

function chainKey(chain: Array<{ path: string; anchor: string | null }>): string {
  return chain.map((hop) => `${hop.path}#${hop.anchor ?? ''}`).join('>');
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

  const visit = (content: string, chain: Array<{ path: string; anchor: string | null }>, depth: number): void => {
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
        const existing = fragments.get(key);
        if (!existing) {
          fragments.set(key, { path: documentPath, anchor, hash: hashText(text), text, chain, extraChains: [] });
        } else if (
          chainKey(existing.chain) !== chainKey(chain)
          && !existing.extraChains.some((known) => chainKey(known) === chainKey(chain))
        ) {
          existing.extraChains.push(chain);
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
        visit(sectionText, [...chain, { path: documentPath, anchor: citation.anchor }], depth + 1);
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
  chain: Array<{ path: string; anchor: string | null }>;
  /** Other chains that reached the same terminal fragment (additive). */
  extraChains?: Array<Array<{ path: string; anchor: string | null }>>;
}

export interface EvidenceManifest {
  schemaVersion: 2;
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
    schemaVersion: 2,
    buildId,
    createdAt: now,
    fragments: fragments.map((fragment) => ({
      path: fragment.path,
      anchor: fragment.anchor,
      hash: fragment.hash,
      text: fragment.text,
      chain: fragment.chain.map((hop) => ({ ...hop })),
      ...(fragment.extraChains.length > 0
        ? { extraChains: fragment.extraChains.map((chain) => chain.map((hop) => ({ ...hop }))) }
        : {}),
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

export function fragmentKey(documentPath: string, anchor: string | null): string {
  return `${documentPath}#${anchor ?? ''}`;
}

/**
 * A deliverable cites `wiki/concepts/x.md#Costs`, a fragment's terminal path is
 * `raw/ingested/a.md`. Index each hop by `path#anchor`, NOT by path alone: two
 * sections of the same concept can rest on different proofs, and a path-only
 * key would hand every section the whole page's closure.
 */
export function frozenFragmentMap(manifest: EvidenceManifest): Map<string, string> {
  const map = new Map<string, string>();
  // Two chains can reach the same proof: dedupe on (key, text), or the same
  // frozen text would be appended twice under a shared hop.
  const seen = new Set<string>();
  const append = (key: string, text: string): void => {
    const signature = `${key}\u0000${text}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    const previous = map.get(key);
    map.set(key, previous ? `${previous}\n\n${text}` : text);
  };
  for (const fragment of manifest.fragments) {
    append(fragmentKey(fragment.path, fragment.anchor), fragment.text);
    for (const chain of [fragment.chain, ...(fragment.extraChains ?? [])]) {
      for (const hop of chain) append(fragmentKey(hop.path, hop.anchor), fragment.text);
    }
  }
  return map;
}

const SAFE_BUILD_ID = /^[a-zA-Z0-9._-]+$/;

/**
 * The manifest id of a deliverable: its sanitized workspace-relative path,
 * suffixed with the content hash when known. The hash is what makes a rebuild
 * a DIFFERENT manifest: without it a second build would overwrite the first,
 * and the first build's export would lose A-v1. Build writes with the hash of
 * the unstamped content; export reads the final id stored in the deliverable.
 */
export function evidenceBuildIdFor(documentRelativePath: string, contentHash?: string | null): string {
  const value = String(documentRelativePath).replace(/\\/g, '/').replace(/[^a-zA-Z0-9._-]/g, '_') || 'deliverable';
  const suffix = contentHash ? `-${String(contentHash).slice(0, 12)}` : '';
  return `${value}${suffix}`;
}

export function evidenceManifestPath(rootDir: string, buildId: string): string {
  if (!SAFE_BUILD_ID.test(buildId)) throw new Error(`invalid build id: ${JSON.stringify(buildId)}`);
  return path.join(rootDir, '.wiki', 'builds', buildId, 'evidence.json');
}

export async function writeEvidenceManifest(rootDir: string, manifest: EvidenceManifest): Promise<string> {
  const buildId = await resolveEvidenceBuildId(rootDir, manifest);
  const finalManifest: EvidenceManifest = buildId === manifest.buildId ? manifest : { ...manifest, buildId };
  const target = evidenceManifestPath(rootDir, buildId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
  return target;
}

/**
 * The id a manifest is written under. The content-derived base id is the one an
 * export re-derives, so it must keep pointing at the FIRST build: when a second
 * build renders the SAME text but rests on DIFFERENT evidence, writing the base
 * would destroy the first build's frozen proof. The second lands under
 * `<base>-<evidenceHash>` instead, discoverable through `listEvidenceBuilds`
 * and recorded in the deliverable as `evidence_build_id` for automatic export.
 */
async function resolveEvidenceBuildId(rootDir: string, manifest: EvidenceManifest): Promise<string> {
  const base = await readEvidenceManifestFile(evidenceManifestPath(rootDir, manifest.buildId));
  if (base === null || sameFragments(base, manifest)) return manifest.buildId;
  const evidenceHash = hashText(
    evidenceSignature(manifest),
  ).slice(0, 12);
  return `${manifest.buildId}-${evidenceHash}`;
}

async function readEvidenceManifestFile(filePath: string): Promise<EvidenceManifest | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as EvidenceManifest;
    return parsed && parsed.schemaVersion === 2 && Array.isArray(parsed.fragments) ? parsed : null;
  } catch {
    return null;
  }
}

function evidenceSignature(manifest: EvidenceManifest): string {
  return JSON.stringify(manifest.fragments.map((fragment) => JSON.stringify({
    path: fragment.path,
    anchor: fragment.anchor,
    hash: fragment.hash,
    text: fragment.text,
    chains: [...new Set([fragment.chain, ...(fragment.extraChains ?? [])]
      .map((chain) => JSON.stringify(chain)))].sort(),
  })).sort());
}

function sameFragments(a: EvidenceManifest, b: EvidenceManifest): boolean {
  return evidenceSignature(a) === evidenceSignature(b);
}

/**
 * The manifests available for a deliverable, newest-agnostic and explicit:
 * `export --evidence-build <id>` picks one instead of the content-derived id.
 * This is what lets a reader export "the first build" after a second exists.
 */
export async function listEvidenceBuilds(rootDir: string, documentRelativePath: string): Promise<string[]> {
  const base = evidenceBuildIdFor(documentRelativePath);
  try {
    const entries = await readdir(path.join(rootDir, '.wiki', 'builds'), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && (entry.name === base || entry.name.startsWith(`${base}-`)))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readEvidenceManifest(rootDir: string, buildId: string): Promise<EvidenceManifest | null> {
  try {
    const raw = await readFile(evidenceManifestPath(rootDir, buildId), 'utf8');
    const parsed = JSON.parse(raw) as EvidenceManifest;
    // v1 stored `chain` as path strings and cannot preserve section
    // granularity. Refuse it explicitly so export emits evidence-missing and
    // falls back visibly instead of pretending the old manifest is precise.
    return parsed && parsed.schemaVersion === 2 && Array.isArray(parsed.fragments) ? parsed : null;
  } catch {
    return null;
  }
}
