import { describe, expect, it } from 'vitest';
import {
  buildGridUserPrompt,
  cleanOpening,
  documentBrief,
  labelTerms,
  MAX_CLASS_LABEL_TERMS,
  MIN_CLASS_EXTENSIONS,
  opaqueDocumentId,
  renderConceptGrid,
  translateGridProposal,
  validateGridProposal,
  type ConceptGridProposal,
  type DocumentBrief,
} from '../src/ingest/conceptGridSynthesis.ts';
import { parseConceptGrid } from '../src/ingest/conceptGrid.ts';

const docs: DocumentBrief[] = [
  { path: 'raw/ingested/a.md', title: 'A', headings: [], opening: '' },
  { path: 'raw/ingested/b.md', title: 'B', headings: [], opening: '' },
  { path: 'raw/ingested/c.md', title: 'C', headings: [], opening: '' },
];

function proposal(over: Partial<ConceptGridProposal> = {}): ConceptGridProposal {
  return {
    classes: [
      {
        id: 'offre-marche',
        label: 'Offre marché',
        covers: 'Les solutions vendues par un éditeur.',
        criterion: 'Le document évalue-t-il un produit vendu par un éditeur ?',
        extensions: ['fiche du 6e éditeur', 'comparatif consolidé', 'réponses écrites'],
      },
      {
        id: 'economie-projet',
        label: 'Économie projet',
        covers: 'Ce que ça coûte.',
        criterion: 'Le document porte-t-il un montant ou une charge ?',
        extensions: ['chiffrage consolidé', 'coût complet à 5 ans', "note d'achat"],
      },
    ],
    assignments: {
      'raw/ingested/a.md': { primary: 'offre-marche', secondary: [] },
      'raw/ingested/b.md': { primary: 'offre-marche', secondary: ['economie-projet'] },
      'raw/ingested/c.md': { primary: 'economie-projet', secondary: [] },
    },
    outOfScope: [],
    ...over,
  };
}

describe('documentBrief', () => {
  /*
   The outline is the point: to decide which CLASSES a corpus needs, the
   author's own headings say more per token than the prose under them. 232 KB
   of raw Demo documents cannot go on the wire of a local engine.
  */
  it('keeps the heading outline and only the opening prose', () => {
    const brief = documentBrief('raw/ingested/x.md', [
      '# Étude Alpha',
      '',
      'Première ligne de prose.',
      '',
      '## Sécurité',
      'Détail que la classe n’a pas besoin de connaître.',
    ].join('\n'));
    expect(brief.title).toBe('Étude Alpha');
    expect(brief.headings).toEqual(['Étude Alpha', '  Sécurité']);
    expect(brief.opening).toContain('Première ligne');
  });

  /*
   Confluence exports the page TOC as a heading whose text IS the whole TOC:
   one ~2 700-character line per document, restating in anchor form the outline
   that follows it. Left in, the biggest documents spend most of their prompt
   budget saying their titles twice.
  */
  it('drops an inline table of contents disguised as a heading', () => {
    const brief = documentBrief('raw/ingested/x.md', [
      '# Étude',
      '## - [](#etude-) - [1. Objet](#etude-1objet) - [2. Modèle](#etude-2modele)',
      '## 1. Objet',
    ].join('\n'));
    expect(brief.headings).toEqual(['Étude', '  1. Objet']);
  });
});

describe('prose-only grid prompt', () => {
  it('shows documents under opaque ids, without leaking paths or titles', () => {
    const prompt = buildGridUserPrompt([
      { path: 'raw/ingested/gestion/dossier-synthese.md', title: 'Synthèse Dossier', headings: ['Synthèse Dossier'], opening: 'Du contenu sémantique.' },
    ]);
    expect(prompt).toContain(`## ${opaqueDocumentId(0)}`);
    expect(prompt).not.toContain('dossier-synthese');
    expect(prompt).not.toContain('Synthèse Dossier');
    expect(prompt).toContain('Du contenu sémantique.');
  });

  it('maps the opaque ids back to real paths after the model answered', () => {
    const idToPath = new Map([[opaqueDocumentId(0), 'raw/ingested/a.md'], [opaqueDocumentId(1), 'raw/ingested/b.md']]);
    const translated = translateGridProposal(
      {
        classes: [],
        assignments: {
          [opaqueDocumentId(0)]: { primary: 'offre-marche', secondary: [] },
          'doc-99': { primary: 'offre-marche', secondary: [] },
        },
        outOfScope: [opaqueDocumentId(1)],
      },
      idToPath,
    );
    expect(Object.keys(translated.assignments)).toEqual(['raw/ingested/a.md', 'doc-99']);
    expect(translated.outOfScope).toEqual(['raw/ingested/b.md']);
  });
});

describe('cleanOpening', () => {
  /*
   The Demo root note opens on an Obsidian breadcrumb and a table of child
   links. Sent as-is it spends the budget the outline should have, and it names
   OTHER documents — inviting the model to file this one by its neighbours.
   */
  it('keeps the link text and drops the navigation furniture', () => {
    expect(cleanOpening(
      '[Demo](../Demo.md) > [Fonctionnel](../F.md) | visio le 2026-01-29<br/>  suite',
    )).toBe('Demo Fonctionnel visio le 2026-01-29 suite');
  });
});

describe('labelTerms', () => {
  it('ignores articles and connectives when comparing labels', () => {
    expect(labelTerms('Offre de marché')).toEqual(['offre', 'marche']);
  });
});

describe('validateGridProposal', () => {
  it('accepts a conformant proposal', () => {
    const result = validateGridProposal(proposal(), docs);
    expect(result.issues).toEqual([]);
  });

  it('rejects two labels sharing a term', () => {
    const result = validateGridProposal(proposal({
      classes: [
        { ...proposal().classes[0]!, label: 'Sécurité marché' },
        { ...proposal().classes[1]!, label: 'Sécurité projet' },
      ],
    }), docs);
    expect(result.issues.join(' ')).toContain('both use the term "securite"');
  });

  it(`rejects a label over ${MAX_CLASS_LABEL_TERMS} terms`, () => {
    const result = validateGridProposal(proposal({
      classes: [
        { ...proposal().classes[0]!, label: 'Offre marché progiciels éditeurs' },
        proposal().classes[1]!,
      ],
    }), docs);
    expect(result.issues.join(' ')).toContain('limit is 2');
  });

  it('rejects a catch-all class label', () => {
    // A short label passes the term-count check on its own — the forbidden-word
    // check (shared with the taxonomy's community labels) is the only thing
    // that catches a class that mirrors R5's own catch-all warning.
    const result = validateGridProposal(proposal({
      classes: [
        { ...proposal().classes[0]!, id: 'divers', label: 'Divers' },
        proposal().classes[1]!,
      ],
    }), docs);
    expect(result.issues.join(' ')).toContain('catch-all');
  });

  it('rejects a membership criterion that is not a question', () => {
    const result = validateGridProposal(proposal({
      classes: [
        { ...proposal().classes[0]!, criterion: 'Le document évalue un produit.' },
        proposal().classes[1]!,
      ],
    }), docs);
    expect(result.issues.join(' ')).toContain('no closed membership question');
  });

  /* The genericity test: a class nobody can name future documents for is a detail. */
  it(`rejects a class with fewer than ${MIN_CLASS_EXTENSIONS} expected documents`, () => {
    const result = validateGridProposal(proposal({
      classes: [
        { ...proposal().classes[0]!, extensions: ['une seule'] },
        proposal().classes[1]!,
      ],
    }), docs);
    expect(result.issues.join(' ')).toContain('too fine to be a filing class');
  });

  it('rejects an unassigned document', () => {
    const assignments = { ...proposal().assignments };
    delete assignments['raw/ingested/c.md'];
    const result = validateGridProposal(proposal({ assignments }), docs);
    expect(result.issues.join(' ')).toContain('unassigned document: raw/ingested/c.md');
  });

  it('accepts an explicitly out-of-scope document', () => {
    const assignments = { ...proposal().assignments };
    delete assignments['raw/ingested/c.md'];
    const result = validateGridProposal(
      proposal({ assignments, outOfScope: ['raw/ingested/c.md'] }),
      docs,
    );
    expect(result.issues.join(' ')).toContain('class "economie-projet" holds no document');
  });

  it('rejects an invented document path', () => {
    const result = validateGridProposal(proposal({
      assignments: { ...proposal().assignments, 'raw/ingested/ghost.md': { primary: 'offre-marche', secondary: [] } },
    }), docs);
    expect(result.issues.join(' ')).toContain('unknown document assigned');
  });

  /* A single-document class is defensible today and not tomorrow: reported, not blocked. */
  it('only warns about a class resting on one document', () => {
    const result = validateGridProposal(proposal({
      assignments: {
        'raw/ingested/a.md': { primary: 'offre-marche', secondary: [] },
        'raw/ingested/b.md': { primary: 'offre-marche', secondary: [] },
        'raw/ingested/c.md': { primary: 'economie-projet', secondary: [] },
      },
    }), docs);
    expect(result.issues).toEqual([]);
    expect(result.warnings.join(' ')).toContain('rests on a single document');
  });
});

describe('renderConceptGrid', () => {
  /* The round trip is the contract: what this pass writes, the ingest must read. */
  it('writes a grid the reader parses back to the same classes', () => {
    const markdown = renderConceptGrid(proposal(), docs, { language: 'fr', warnings: [] });
    const read = parseConceptGrid(markdown);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.grid.classes).toEqual(['offre-marche', 'economie-projet']);
    expect(markdown).toContain('Le document porte-t-il un montant ou une charge ?');
  });
});

/*
 R5 — "do not reproduce the folder tree" — used to be a sentence in the prompt.
 A real run answered it with the three source directories, so it is a rejection
 now. The comparison is on TOKENS because that run's classes were the folders
 with their prefixes trimmed: `solution-externe` against a folder named
 `synthese-solutions-externes`.
*/
describe('folder-mirror rejection', () => {
  const documents = [
    'raw/ingested/gestion/dossier/synthese-de-la-demande-fonctionnelle.md',
    'raw/ingested/gestion/dossier/synthese-solutions-externes/fiche-a.md',
    'raw/ingested/gestion/dossier/synthese-option-developpement-interne/note-b.md',
  ].map((path) => documentBrief(path, `# Titre\n\nUn paragraphe de corps assez long pour compter.`));

  const klass = (id: string) => ({
    id,
    label: id,
    covers: 'Ce que la classe recouvre, en une phrase suffisamment longue.',
    criterion: 'Le document relève-t-il de cette classe ?',
    extensions: ['un', 'deux', 'trois'],
  });
  const proposalOf = (ids: string[]) => ({
    classes: ids.map(klass),
    assignments: Object.fromEntries(
      documents.map((document, index) => [
        document.path,
        { primary: ids[index % ids.length]!, secondary: [] },
      ]),
    ),
    outOfScope: [],
  });

  it('rejects a grid whose classes are the source folders, and names them', () => {
    const ids = ['demande-fonctionnelle', 'developpement-interne', 'solution-externe'];
    const issues = validateGridProposal(proposalOf(ids), documents).issues.join(' ');
    expect(issues).toContain('reproduce a folder of the corpus');
    for (const id of ids) expect(issues).toContain(id);
  });

  it('leaves a semantic grid alone', () => {
    const issues = validateGridProposal(
      proposalOf(['offre-marche', 'souverainete-hebergement', 'economie-projet']),
      documents,
    ).issues.join(' ');
    expect(issues).not.toContain('reproduce a folder');
  });

  it('tolerates a single class that happens to echo a folder', () => {
    const issues = validateGridProposal(
      proposalOf(['offre-marche', 'souverainete-hebergement', 'demande-fonctionnelle']),
      documents,
    ).issues.join(' ');
    expect(issues).not.toContain('reproduce a folder');
  });
});
