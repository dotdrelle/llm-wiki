import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { extractBodyCitations } from '../../provenance/derive.ts';
import { resolveAnchor } from '../../provenance/locators.ts';
import {
  fragmentKey,
  listEvidenceBuilds,
  readEvidenceManifest,
  resolveEvidence,
  type EvidenceManifest,
} from '../../provenance/resolver.ts';
import { exportArtifactSourcePath, isExportArtifactPath } from '../../utils/exportArtifact.ts';
import { hashText } from '../../utils/hash.ts';
import { splitMarkdownSections } from '../../utils/markdown.ts';
import { resolveInside, toPosix } from '../../utils/path.ts';

/**
 * The provenance reading of ONE deliverable, as the graph's Provenance view
 * draws it: what produced it (template, build context), the sections that
 * cite, the wiki pages each citation travelled through (pivots, fiches) and
 * the exact fragments of `raw/ingested/` it rests on.
 *
 * It is a reader of what build already froze — `.wiki/builds/<id>/evidence.json`
 * selected by the deliverable's `evidence_build_id` — and of nothing else: no
 * model call, no second resolver. `mode: 'live'` re-resolves the current files
 * with the build's own `resolveEvidence`; a missing or unreadable manifest
 * falls back to that live reading and says so, exactly like `export` does.
 *
 * A manifest chain starts at the first wiki page cited, not at the deliverable
 * section: the section is recovered by matching each section's own `[src:]`
 * citations (same parser as build) against the chain's first hop.
 */

export type ProvenanceNodeKind =
  | 'template'
  | 'context'
  | 'deliverable'
  | 'section'
  | 'pivot'
  | 'fiche'
  | 'page'
  | 'fragment';

export interface ProvenanceNode {
  id: string;
  kind: ProvenanceNodeKind;
  /** Column of the left-to-right reading: 0 produced-by … 4 the proof. */
  col: number;
  title: string;
  /** Workspace-relative file the node reads from (a fragment: its archive). */
  path: string;
  anchor?: string;
  /** Fragment only: the evidence text (frozen or current), bounded. */
  text?: string;
  /**
   * Fragment: how the current archive compares with the evidence shown.
   * Page: `missing` when a page the build went through no longer exists.
   */
  status?: 'unchanged' | 'changed' | 'missing';
  /** Fragment only, when `status` is `changed`: the other side of the comparison. */
  otherText?: string;
}

export interface ProvenanceEdge {
  source: string;
  target: string;
  kind: 'uses' | 'produces' | 'section' | 'cites';
}

export interface ProvenanceGraph {
  requested: string;
  /** The source deliverable (an export artifact resolves to it). */
  root: string;
  artifact: boolean;
  source: 'frozen' | 'live';
  buildId: string | null;
  builds: Array<{ id: string; createdAt: string | null }>;
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
  /** Each chain is a node-id path from a section to a fragment. */
  chains: string[][];
  /** Live reading only: chains the build used that no longer resolve today. */
  brokenChains: string[][];
  degradations: string[];
}

export class ProvenanceGraphError extends Error {
  readonly code: 'INVALID_DELIVERABLE' | 'DELIVERABLE_NOT_FOUND';

  constructor(code: 'INVALID_DELIVERABLE' | 'DELIVERABLE_NOT_FOUND', message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_FRAGMENT_TEXT = 1200;
const bounded = (text: string): string => (text.length > MAX_FRAGMENT_TEXT ? `${text.slice(0, MAX_FRAGMENT_TEXT)}…` : text);
type Hop = { path: string; anchor: string | null };

function humanize(value: string): string {
  const text = value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : value;
}

function titleOf(content: string | null, file: string): string {
  if (content) {
    try {
      const parsed = matter(content);
      if (typeof parsed.data.title === 'string' && parsed.data.title.trim()) return parsed.data.title.trim();
      const heading = /^#\s+(.+?)\s*$/m.exec(parsed.content);
      if (heading) return heading[1]!.trim();
    } catch {
      // A malformed front matter is lint's to report; the basename still names it.
    }
  }
  return humanize(path.posix.basename(file, '.md'));
}

function kindOfPage(file: string): { kind: ProvenanceNodeKind; col: number } {
  if (file.startsWith('wiki/sources/')) return { kind: 'fiche', col: 3 };
  if (file.startsWith('wiki/concepts/')) return { kind: 'pivot', col: 2 };
  return { kind: 'page', col: 2 };
}

function normalizeRequested(id: string): string {
  const clean = toPosix(String(id ?? '')).replace(/^\/+/, '');
  if (!clean.startsWith('deliverables/') || !clean.endsWith('.md') || clean.split('/').includes('..')) {
    throw new ProvenanceGraphError('INVALID_DELIVERABLE', `Not a deliverable: ${id}`);
  }
  return clean;
}

export async function loadProvenanceGraph(
  rootDir: string,
  id: string,
  options: { build?: string | null; mode?: 'frozen' | 'live' } = {},
): Promise<ProvenanceGraph> {
  const requested = normalizeRequested(id);
  const documents = new Map<string, string | null>();
  const load = (file: string): string | null => {
    if (!documents.has(file)) {
      let content: string | null = null;
      try {
        const absolute = resolveInside(rootDir, file);
        content = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
      } catch {
        content = null;
      }
      documents.set(file, content);
    }
    return documents.get(file) ?? null;
  };

  const requestedContent = load(requested);
  if (requestedContent === null) throw new ProvenanceGraphError('DELIVERABLE_NOT_FOUND', `Deliverable not found: ${requested}`);
  const degradations: string[] = [];
  const artifact = isExportArtifactPath(requested);
  let root = requested;
  if (artifact) {
    const sourcePath = exportArtifactSourcePath(requested);
    if (sourcePath && load(sourcePath) !== null) root = sourcePath;
    else degradations.push(`source deliverable not found for export artifact: ${sourcePath ?? requested}`);
  }
  const rootContent = load(root) ?? requestedContent;

  // ---------- which evidence ----------
  const builds = await Promise.all((await listEvidenceBuilds(rootDir, root)).map(async (buildId) => ({
    id: buildId,
    manifest: await readEvidenceManifest(rootDir, buildId),
  })));
  const storedId = (() => {
    try {
      const value: unknown = matter(requestedContent).data.evidence_build_id ?? matter(rootContent).data.evidence_build_id;
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  })();
  let manifest: EvidenceManifest | null = null;
  let buildId: string | null = null;
  const wanted = options.build ?? storedId;
  if (wanted) {
    const known = builds.find((entry) => entry.id === wanted);
    manifest = known?.manifest ?? (known ? null : await readEvidenceManifest(rootDir, wanted).catch(() => null));
    if (manifest) buildId = wanted;
    else degradations.push(`evidence manifest missing or unreadable: ${wanted}`);
  } else {
    degradations.push('no evidence_build_id on the deliverable (built before the evidence manifest)');
  }

  type Fragment = { path: string; anchor: string; hash: string; text: string; chains: Hop[][] };
  let fragments: Fragment[];
  let source: 'frozen' | 'live';
  if (manifest && options.mode !== 'live') {
    source = 'frozen';
    fragments = manifest.fragments.map((entry) => ({
      path: entry.path,
      anchor: entry.anchor,
      hash: entry.hash,
      text: entry.text,
      chains: [entry.chain, ...(entry.extraChains ?? [])],
    }));
  } else {
    source = 'live';
    if (artifact && root === requested) {
      degradations.push('an export artifact carries no [src:] marker: nothing to resolve live');
    }
    const live = resolveEvidence({ content: rootContent, loadDocument: load });
    degradations.push(...live.degradations);
    fragments = live.fragments.map((entry) => ({
      path: entry.path,
      anchor: entry.anchor,
      hash: entry.hash,
      text: entry.text,
      chains: [entry.chain, ...entry.extraChains],
    }));
    if (manifest) {
      const reached = new Set(fragments.map((entry) => fragmentKey(entry.path, entry.anchor)));
      for (const frozen of manifest.fragments) {
        if (!reached.has(fragmentKey(frozen.path, frozen.anchor))) {
          degradations.push(`no longer reached since the build: ${fragmentKey(frozen.path, frozen.anchor)}`);
        }
      }
    }
  }

  // ---------- nodes ----------
  const nodes = new Map<string, ProvenanceNode>();
  const edges = new Map<string, ProvenanceEdge>();
  const addNode = (node: ProvenanceNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); return node.id; };
  const addEdge = (sourceId: string, target: string, kind: ProvenanceEdge['kind']) => {
    const key = `${sourceId}\u0000${target}\u0000${kind}`;
    if (!edges.has(key)) edges.set(key, { source: sourceId, target, kind });
  };

  addNode({ id: root, kind: 'deliverable', col: 1, title: titleOf(rootContent, root), path: root });
  try {
    const state = JSON.parse(await readFile(path.join(rootDir, '.wiki', 'build-state.json'), 'utf8')) as {
      deliverables?: Record<string, { outputRelativePath?: unknown }>;
    };
    const template = Object.entries(state.deliverables ?? {})
      .find(([, record]) => typeof record.outputRelativePath === 'string' && toPosix(record.outputRelativePath) === root)?.[0];
    if (template) {
      const templatePath = toPosix(template);
      const templateContent = load(templatePath);
      addNode({ id: templatePath, kind: 'template', col: 0, title: titleOf(templateContent, templatePath), path: templatePath });
      addEdge(templatePath, root, 'produces');
      let refs: unknown = [];
      try { refs = templateContent ? matter(templateContent).data.build_context : []; } catch { refs = []; }
      for (const ref of Array.isArray(refs) ? refs : []) {
        if (typeof ref !== 'string') continue;
        const clean = toPosix(ref).replace(/^\/+/, '');
        const contextPath = clean.endsWith('.md') ? clean : `${clean}.md`;
        addNode({ id: contextPath, kind: 'context', col: 0, title: titleOf(load(contextPath), contextPath), path: contextPath });
        addEdge(contextPath, templatePath, 'uses');
      }
    } else {
      degradations.push('no template recorded for this deliverable in .wiki/build-state.json');
    }
  } catch {
    degradations.push('no .wiki/build-state.json: the producing template is unknown');
  }

  // Sections of the deliverable and the citations each one carries.
  const sections: Array<{ id: string; citations: Set<string> }> = [];
  const document = splitMarkdownSections(rootContent);
  const sectionBlocks = [
    ...(document.preamble.trim() ? [{ label: 'Introduction', markdown: document.preamble }] : []),
    ...document.sections.map((section) => ({ label: section.headingText || 'Section', markdown: section.markdown })),
  ];
  sectionBlocks.forEach((block, index) => {
    const citations = new Set(extractBodyCitations(block.markdown).map((citation) => fragmentKey(citation.path, citation.anchor)));
    if (!citations.size) return;
    const sectionId = `section:${index}`;
    addNode({ id: sectionId, kind: 'section', col: 1, title: block.label, path: root });
    addEdge(root, sectionId, 'section');
    sections.push({ id: sectionId, citations });
  });

  const chains: string[][] = [];
  const chainKeys = new Set<string>();
  for (const fragment of fragments) {
    const fragmentId = `fragment:${fragmentKey(fragment.path, fragment.anchor)}`;
    const archive = load(fragment.path);
    let status: ProvenanceNode['status'];
    let otherText: string | undefined;
    if (source === 'frozen') {
      if (archive === null) status = 'missing';
      else {
        const current = fragment.anchor ? resolveAnchor(archive, fragment.anchor) : { status: 'resolved' as const, text: archive };
        if (current.status !== 'resolved') status = 'missing';
        else if (hashText(current.text) === fragment.hash) status = 'unchanged';
        else { status = 'changed'; otherText = bounded(current.text); }
      }
    } else {
      const frozen = manifest?.fragments.find((entry) => entry.path === fragment.path && entry.anchor === fragment.anchor);
      status = frozen && frozen.hash !== fragment.hash ? 'changed' : 'unchanged';
      if (frozen && status === 'changed') otherText = bounded(frozen.text);
    }
    addNode({
      id: fragmentId,
      kind: 'fragment',
      col: 4,
      title: titleOf(archive, fragment.path),
      path: fragment.path,
      anchor: fragment.anchor,
      text: bounded(fragment.text),
      status,
      ...(otherText !== undefined ? { otherText } : {}),
    });
    if (source === 'frozen' && !fragment.anchor) {
      degradations.push(`unanchored citation (whole file): ${fragment.path}`);
    }
    for (const hops of fragment.chains) {
      const hopIds = hops.map((hop) => {
        const { kind, col } = kindOfPage(hop.path);
        const content = load(hop.path);
        if (content === null && source === 'frozen') degradations.push(`page no longer exists since the build: ${hop.path}`);
        return addNode({
          id: hop.path, kind, col, title: titleOf(content, hop.path), path: hop.path,
          ...(content === null ? { status: 'missing' as const } : {}),
        });
      });
      const first = hops[0] ? fragmentKey(hops[0].path, hops[0].anchor) : fragmentKey(fragment.path, fragment.anchor);
      const owners = sections.filter((section) => section.citations.has(first)).map((section) => section.id);
      for (const start of owners.length ? owners : [root]) {
        const ids = [start, ...hopIds, fragmentId];
        const key = ids.join('>');
        if (chainKeys.has(key)) continue;
        chainKeys.add(key);
        chains.push(ids);
        for (let i = 0; i < ids.length - 1; i += 1) addEdge(ids[i]!, ids[i + 1]!, 'cites');
      }
    }
  }
  if (!fragments.length) degradations.push('no evidence fragment: the deliverable cites nothing resolvable');

  // Live reading: what the build used and today's files no longer reach is
  // drawn too, as broken chains — a vanished proof must stay visible.
  const brokenChains: string[][] = [];
  if (source === 'live' && manifest) {
    const reached = new Set(fragments.map((entry) => fragmentKey(entry.path, entry.anchor)));
    for (const frozen of manifest.fragments) {
      if (reached.has(fragmentKey(frozen.path, frozen.anchor))) continue;
      const fragmentId = `fragment:${fragmentKey(frozen.path, frozen.anchor)}`;
      addNode({
        id: fragmentId, kind: 'fragment', col: 4, title: titleOf(load(frozen.path), frozen.path), path: frozen.path,
        anchor: frozen.anchor, text: bounded(frozen.text), status: 'missing',
      });
      for (const hops of [frozen.chain, ...(frozen.extraChains ?? [])]) {
        const hopIds = hops.map((hop) => {
          const { kind, col } = kindOfPage(hop.path);
          // A page gone since the build is usually WHY the chain broke: flag
          // it here too, as the frozen reading does.
          const content = load(hop.path);
          if (content === null) degradations.push(`page no longer exists since the build: ${hop.path}`);
          return addNode({
            id: hop.path, kind, col, title: titleOf(content, hop.path), path: hop.path,
            ...(content === null ? { status: 'missing' as const } : {}),
          });
        });
        const first = hops[0] ? fragmentKey(hops[0].path, hops[0].anchor) : fragmentKey(frozen.path, frozen.anchor);
        const owners = sections.filter((section) => section.citations.has(first)).map((section) => section.id);
        for (const start of owners.length ? owners : [root]) brokenChains.push([start, ...hopIds, fragmentId]);
      }
    }
  }

  return {
    requested,
    root,
    artifact,
    source,
    buildId,
    builds: builds.map((entry) => ({ id: entry.id, createdAt: entry.manifest?.createdAt ?? null })),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    chains,
    brokenChains,
    degradations: [...new Set(degradations)],
  };
}
