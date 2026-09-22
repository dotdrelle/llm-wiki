import type { WikiOperation } from '../types.ts';
import { deriveTerminalSources, extractBodyCitations } from './derive.ts';
import { resolveAnchor } from './locators.ts';

/*
 * The two-level citation shape, applied deterministically.
 *
 * The consolidation prompt asks a concept LEAF to cite the source note, not the
 * archive; the model does not always comply. When the plan writes a source note
 * for THIS source, a leaf's section-precise archive citation may be moved onto
 * the source note — but only when it is SAFE:
 *
 *  - the source note section must PROVE the same fragment the leaf's citation
 *    names (same archive, same section, or the whole file). A same-named heading
 *    that cites another fragment is not equivalent and is refused;
 *  - a citation the previous body already carried is LEFT VERBATIM, as the plan
 *    requires for legacy `concept → raw` citations: the mere existence of a
 *    source note must not rewrite it.
 *
 * Anything else keeps its archive form: an honest archive path beats a
 * source-note path whose proof is not the one the citation claims.
 */

export function retargetLeafCitationsToSourceNote(
  operations: WikiOperation[],
  options: {
    sourcePagePath: string;
    archiveCitationPath: string;
    sourceNoteContent: string | null;
    /** The page as it exists BEFORE this write, to preserve legacy citations. */
    previousContentOf?: (pagePath: string) => string | null;
    /** Resolves a cited page's body (in-batch pages included). */
    resolvePage?: (pagePath: string) => string | null;
  },
): { operations: WikiOperation[]; retargeted: number } {
  const note = options.sourceNoteContent;
  if (!note) return { operations, retargeted: 0 };
  let retargeted = 0;
  const next = operations.map((operation) => {
    if (operation.type === 'delete' || typeof operation.content !== 'string') return operation;
    if (!/^wiki\/concepts\//.test(operation.path)) return operation;
    const previous = options.previousContentOf?.(operation.path) ?? null;
    const legacy = previous
      ? new Set(
          extractBodyCitations(previous)
            .filter((citation) => citation.path === options.archiveCitationPath)
            .map((citation) => citation.anchor ?? ''),
        )
      : null;
    const content = operation.content.replace(
      /\[src:\s*([^\]#\s]+)(?:#([^\]]+))?\]/g,
      (match, citedPath: string, anchor: string | undefined) => {
        if (citedPath !== options.archiveCitationPath || !anchor) return match;
        // A legacy citation the page already carried is preserved verbatim.
        if (legacy?.has(anchor)) return match;
        // Proof equivalence: the source note section must reach the very
        // fragment this citation names, or the whole archive file.
        if (!sourceNoteSectionProves(note, anchor, options.archiveCitationPath, options.resolvePage)) {
          return match;
        }
        retargeted += 1;
        return `[src: ${options.sourcePagePath}#${anchor}]`;
      },
    );
    return content === operation.content ? operation : { ...operation, content };
  });
  return { operations: next, retargeted };
}

/**
 * Whether the source-note section `anchor` proves the archive fragment the leaf
 * cited: its own terminal closure must reach `raw/…/<archive>#<anchor>` (the
 * same section) or the whole archive file. A section that cites a different
 * fragment of the same file does NOT qualify.
 */
function sourceNoteSectionProves(
  note: string,
  anchor: string,
  archiveCitationPath: string,
  resolvePage: ((pagePath: string) => string | null) | undefined,
): boolean {
  const resolution = resolveAnchor(note, anchor);
  if (resolution.status !== 'resolved') return false;
  const { fragments } = deriveTerminalSources({
    content: resolution.text,
    ...(resolvePage ? { resolvePage } : {}),
  });
  return fragments.some(
    (fragment) =>
      fragment.path === archiveCitationPath
      && (fragment.anchor === anchor || fragment.anchor === null),
  );
}
