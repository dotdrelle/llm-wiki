import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeExtractions,
  sourceExtractionSchema,
  type SourceExtraction,
} from '../src/ingest/extractionSchema.ts';
import {
  consolidationCacheName,
  extractionCacheName,
  IngestCache,
} from '../src/ingest/extractionCache.ts';
import { consolidationPlanSchema } from '../src/ingest/consolidationSchema.ts';
import {
  collectionFromSourcePath,
  readProvenance,
} from '../src/ingest/provenance.ts';
import { detectConceptOverflow, detectConceptSplits, detectDuplicatePaths, validateConsolidation } from '../src/ingest/consolidationValidate.ts';
import { buildConsolidationRetryUser } from '../src/prompts/consolidationPrompt.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function extraction(label: string): SourceExtraction {
  return sourceExtractionSchema.parse({
    facts: [{ statement: `Fait ${label}`, subject: 's1', citation: 'raw/ingested/source.md' }],
    subjects: [{
      id: 's1', label, scope: 'product', importance: 'core', rationale: 'Identité explicite.',
    }],
    relations: [],
    mainSubject: 's1',
  });
}

describe('contrat d’extraction du Lot 2', () => {
  it('refuse un identifiant de sujet qui est un chemin', () => {
    // Structurel : un `subjects[].id` doit être un identifiant local (`s1`, ...),
    // jamais un chemin. La dégradation n'intervient que sur les RÉFÉRENCES, pas
    // sur la déclaration elle-même.
    expect(sourceExtractionSchema.safeParse({
      facts: [],
      subjects: [{ id: 'wiki/concepts/a.md', label: 'A', scope: 'product', rationale: 'x' }],
      relations: [],
      mainSubject: null,
    }).success).toBe(false);
  });

  it('dégrade les références à des sujets inconnus sans rejeter la source', () => {
    // Un modèle peut référencer un id de fait, un libellé ou une cible absente de
    // `subjects[]`. Ces références sont écartées et journalisées ; la source ne
    // doit pas être perdue pour un repère que personne ne peut résoudre.
    const parsed = sourceExtractionSchema.parse({
      facts: [
        { statement: 'Fait rattaché', subject: 's1', citation: 'raw/ingested/a.md' },
        { statement: 'Fait orphelin', subject: 'E01', citation: 'raw/ingested/a.md' },
      ],
      subjects: [{
        id: 's1', label: 'Anaplan', scope: 'product', importance: 'core', rationale: 'Sujet explicite.',
      }],
      relations: [{ from: 's1', to: 's1', kind: 'mentions' }, { from: 's1', to: 'E01', kind: 'mentions' }],
      mainSubject: 'absent',
    });
    expect(parsed.facts.map((fact) => fact.subject)).toEqual(['s1', null]);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.relations[0]?.to).toBe('s1');
    expect(parsed.mainSubject).toBeNull();
    expect(parsed._dangling).toEqual({ orphanedRelations: 1, orphanedFacts: 1 });
  });

  it('traite un id de sujet malformé comme une erreur structurelle, pas une référence orpheline', () => {
    // La dégradation ne couvre que les RÉFÉRENCES (relations, `mainSubject`,
    // `facts[].subject`). Un sujet DÉCLARÉ à l'id mal formé reste une erreur de
    // structure : on ne peut pas accepter un identifiant que le contrat de sujet
    // lui-même refuse.
    expect(sourceExtractionSchema.safeParse({
      facts: [],
      subjects: [{ id: 'ma forme', label: 'A', scope: 'product', importance: 'core', rationale: 'x' }],
      relations: [],
      mainSubject: null,
    }).success).toBe(false);
  });

  it('qualifie les identifiants locaux par lot et conserve l’ordre', () => {
    const merged = mergeExtractions([extraction('Anaplan'), extraction('Anaplan')]);
    expect(merged.subjects.map((subject) => subject.id)).toEqual(['b1_s1', 'b2_s1']);
    expect(merged.facts.map((fact) => fact.subject)).toEqual(['b1_s1', 'b2_s1']);
    expect(merged.mainSubject).toBe('b1_s1');
  });

  it('normalise les synonymes structurés observés sur Albert', () => {
    const parsed = sourceExtractionSchema.parse({
      facts: [{ text: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [{
        id: 's1', name: 'Anaplan', scope: 'product', importance: 'core',
        justification: 'Sujet explicite.',
      }],
      relations: [{ from: 's1', to: 's1', type: 'mentions' }],
      mainSubject: 's1',
    });
    expect(parsed.facts[0]?.statement).toBe('Fait');
    expect(parsed.subjects[0]?.label).toBe('Anaplan');
    expect(parsed.relations[0]?.kind).toBe('mentions');
  });

  it('synthétise une rationale par défaut quand le modèle l’omet', () => {
    // Un moteur peut renvoyer des `subjects` sans aucun champ de justification
    // (ni rationale, ni justification/reason/why). Plutôt que de rejeter toute
    // la source sur un champ purement consultatif, on dérive une rationale des
    // informations déclarées (`scope` + `importance`).
    const parsed = sourceExtractionSchema.parse({
      facts: [{ statement: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [{
        id: 's1', label: 'Prophix', scope: 'product', importance: 'core',
      }],
      relations: [],
      mainSubject: null,
    });
    expect(parsed.subjects[0]?.rationale).toBe(
      'Declared as a core product subject; the model provided no rationale.',
    );
  });

  it('coerce un importance ou un scope hors vocabulaire au lieu de rejeter la source', () => {
    // Un moteur peut écrire une valeur hors du vocabulaire fermé (forme
    // capitalisée, quasi-synonyme, mot français). Ces champs sont consultatifs
    // pour la consolidation : on les normalise plutôt que de perdre la source.
    const parsed = sourceExtractionSchema.parse({
      facts: [{ statement: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [
        { id: 's1', label: 'A', scope: 'Product', importance: 'HIGH', rationale: 'x' },
        { id: 's2', label: 'B', scope: 'transversal', importance: 'faible', rationale: 'x' },
        { id: 's3', label: 'C', scope: 'inconnu', importance: 'inconnue', rationale: 'x' },
      ],
      relations: [],
      mainSubject: null,
    });
    expect(parsed.subjects.map((subject) => subject.scope)).toEqual(['product', 'transverse', 'product']);
    expect(parsed.subjects.map((subject) => subject.importance)).toEqual(['core', 'incidental', 'supporting']);
  });

  it('laisse intacts les scope et importance déjà valides', () => {
    // La normalisation est strictement admissive : une valeur conforme au
    // vocabulaire fermé ressort identique, sans passage par les synonymes ni
    // le repli.
    const parsed = sourceExtractionSchema.parse({
      facts: [{ statement: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [
        { id: 's1', label: 'A', scope: 'source', importance: 'core', rationale: 'x' },
        { id: 's2', label: 'B', scope: 'product', importance: 'supporting', rationale: 'x' },
        { id: 's3', label: 'C', scope: 'transverse', importance: 'incidental', rationale: 'x' },
        { id: 's4', label: 'D', scope: 'workspace', importance: 'core', rationale: 'x' },
      ],
      relations: [],
      mainSubject: null,
    });
    expect(parsed.subjects.map((subject) => subject.scope)).toEqual(['source', 'product', 'transverse', 'workspace']);
    expect(parsed.subjects.map((subject) => subject.importance)).toEqual(['core', 'supporting', 'incidental', 'core']);
  });

  it('normalise un kind hors vocabulaire vers sa nature, et coerce l’inconnu vers product', () => {
    // `kind` est un vocabulaire fermé au même titre que `scope` : un moteur qui
    // écrit « éditeur » (français) ou « solution » (synonyme) doit être compris,
    // pas rejeté. Un kind réellement inconnu retombe sur `product`, le défaut sûr.
    const parsed = sourceExtractionSchema.parse({
      facts: [{ statement: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [
        { id: 's1', label: 'A', scope: 'product', kind: 'vendor', rationale: 'x' },
        { id: 's2', label: 'B', scope: 'product', kind: 'editeur', rationale: 'x' },
        { id: 's3', label: 'C', scope: 'transverse', kind: 'SECURITY', rationale: 'x' },
        { id: 's4', label: 'D', scope: 'product', kind: 'solution', rationale: 'x' },
        { id: 's5', label: 'E', scope: 'product', kind: 'inconnu', rationale: 'x' },
      ],
      relations: [],
      mainSubject: null,
    });
    expect(parsed.subjects.map((subject) => subject.kind)).toEqual(['vendor', 'vendor', 'dimension', 'product', 'product']);
  });

  it('garde un kind déjà valide identique à lui-même', () => {
    const parsed = sourceExtractionSchema.parse({
      facts: [{ statement: 'Fait', subject: 's1', citation: 'raw/ingested/a.md' }],
      subjects: [
        { id: 's1', label: 'A', scope: 'product', kind: 'vendor', rationale: 'x' },
        { id: 's2', label: 'B', scope: 'product', kind: 'product', rationale: 'x' },
        { id: 's3', label: 'C', scope: 'product', kind: 'requirement', rationale: 'x' },
        { id: 's4', label: 'D', scope: 'product', kind: 'regulation', rationale: 'x' },
        { id: 's5', label: 'E', scope: 'product', kind: 'dimension', rationale: 'x' },
        { id: 's6', label: 'F', scope: 'product', kind: 'scenario', rationale: 'x' },
      ],
      relations: [],
      mainSubject: null,
    });
    expect(parsed.subjects.map((subject) => subject.kind)).toEqual(['vendor', 'product', 'requirement', 'regulation', 'dimension', 'scenario']);
  });

  it('résout un sujet principal rendu par libellé vers son identifiant local', () => {
    const parsed = sourceExtractionSchema.parse({
      facts: [],
      subjects: [{
        id: 's1', label: 'Exigences fonctionnelles générales', scope: 'workspace',
        importance: 'core', rationale: 'Sujet explicite.',
      }],
      relations: [],
      mainSubject: 'Exigences fonctionnelles générales',
    });
    expect(parsed.mainSubject).toBe('s1');
  });
});

describe('provenance et consolidation', () => {
  it('rattache une provenance sans chemin aux opérations dans le même ordre', () => {
    const parsed = consolidationPlanSchema.parse({
      operations: [
        { type: 'create', path: 'wiki/sources/a.md', content: '# A' },
        { type: 'create', path: 'wiki/concepts/a.md', content: '# A' },
        { type: 'update', path: 'wiki/index.md', content: '# Index' },
      ],
      pages: [
        { subject: 'a', scope: 'source' },
        { subject: 'a', scope: 'product' },
      ],
    });
    expect(parsed.pages.map((page) => page.path)).toEqual([
      'wiki/sources/a.md', 'wiki/concepts/a.md',
    ]);
  });

  it('déduit la collection du parent immédiat, pas de la racine d’export', () => {
    expect(collectionFromSourcePath(
      'raw/untracked/Outils de gestion/EAS ACPI/Synthèse Solutions externes/Anaplan.md',
    )).toBe('synthese-solutions-externes');
    expect(collectionFromSourcePath('raw/untracked/Anaplan.md')).toBeNull();
  });

  it('injecte une provenance canonique sans promouvoir group en subject', () => {
    const plan = consolidationPlanSchema.parse({
      summary: 'Une note et un concept.',
      operations: [
        { type: 'create', path: 'wiki/sources/anaplan.md', content: '# Source\n\n[src: raw/ingested/anaplan.md]\n' },
        { type: 'create', path: 'wiki/concepts/anaplan.md', content: '---\ngroup: security\n---\n# Anaplan\n\n[src: raw/ingested/anaplan.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/anaplan.md', subject: 'Anaplan', scope: 'source' },
        { path: 'wiki/concepts/anaplan.md', subject: 'Anaplan', scope: 'product', kind: 'product', rationale: 'Sujet comparé.' },
      ],
    });
    const result = validateConsolidation(plan, {
      sourcePagePath: 'wiki/sources/anaplan.md',
      citationPath: 'raw/ingested/anaplan.md',
      existingPaths: new Set(),
      collection: 'solutions-externes',
    });
    expect(result.errors).toEqual([]);
    const concept = result.operations.find((operation) => operation.path.includes('concepts'))!;
    expect(readProvenance(concept.content ?? '')).toEqual({
      subject: 'anaplan', collection: 'solutions-externes', scope: 'product', kind: 'product',
    });
    expect(concept.content).toContain('group: security');
  });

  it('refuse une seconde note de source et les collisions atomiquement', () => {
    const plan = consolidationPlanSchema.parse({
      operations: [
        { type: 'create', path: 'wiki/sources/a.md', content: '# A' },
        { type: 'create', path: 'wiki/sources/b.md', content: '# B' },
        { type: 'update', path: 'wiki/sources/a.md', content: '# A2' },
      ],
    });
    const result = validateConsolidation(plan, {
      sourcePagePath: 'wiki/sources/a.md', citationPath: 'raw/ingested/a.md',
      existingPaths: new Set(), collection: null,
    });
    expect(result.errors.some((issue) => issue.reason.includes('secondary'))).toBe(true);
    expect(result.errors.some((issue) => issue.reason.includes('duplicate'))).toBe(true);
  });

  it('signale un produit atomisé en plusieurs concepts, sans bloquer la publication', () => {
    // Board (le produit) + Board International (son éditeur) : une seule
    // identité, deux pages. C'est une réservation visible — le budget ne la
    // voyait pas — jamais une erreur qui perdrait la source.
    const plan = consolidationPlanSchema.parse({
      summary: 'Produit et éditeur.',
      operations: [
        { type: 'create', path: 'wiki/sources/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board-international.md', content: '# Board International\n\n[src: raw/ingested/board.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/board.md', subject: 'board', scope: 'source', kind: 'vendor' },
        { path: 'wiki/concepts/board.md', subject: 'board', scope: 'product', kind: 'product', rationale: 'Solution comparée.' },
        { path: 'wiki/concepts/board-international.md', subject: 'board-international', scope: 'product', kind: 'vendor', rationale: 'Éditeur.' },
      ],
    });
    const result = validateConsolidation(plan, {
      sourcePagePath: 'wiki/sources/board.md', citationPath: 'raw/ingested/board.md',
      existingPaths: new Set(), collection: null,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((issue) => issue.reason.includes('concept split'))).toBe(true);
  });

  it('ne signale pas deux sujets réellement distincts', () => {
    // Anaplan et Pigment partagent une collection, pas une identité : la règle
    // ne doit pas crier au doublon sur des sujets différents.
    const plan = consolidationPlanSchema.parse({
      summary: 'Deux solutions.',
      operations: [
        { type: 'create', path: 'wiki/sources/synthese.md', content: '# Synthèse\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/anaplan.md', content: '# Anaplan\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/pigment.md', content: '# Pigment\n\n[src: raw/ingested/s.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/synthese.md', subject: 'synthese', scope: 'source' },
        { path: 'wiki/concepts/anaplan.md', subject: 'anaplan', scope: 'product', kind: 'product', rationale: 'Solution.' },
        { path: 'wiki/concepts/pigment.md', subject: 'pigment', scope: 'product', kind: 'product', rationale: 'Solution.' },
      ],
    });
    const result = validateConsolidation(plan, {
      sourcePagePath: 'wiki/sources/synthese.md', citationPath: 'raw/ingested/s.md',
      existingPaths: new Set(), collection: null,
    });
    expect(result.warnings.some((issue) => issue.reason.includes('concept split'))).toBe(false);
  });

  it('normalise un kind qui confond scope et kind (observed: kind="workspace")', () => {
    // Le modèle a confondu les deux vocabulaires fermés : il a écrit la valeur
    // d'un SCOPE dans `kind`. La consolidation doit normaliser au lieu de
    // rejeter toute la source — exactement le même admissivisme que `scope`.
    const parsed = consolidationPlanSchema.parse({
      summary: 'Confusion.',
      operations: [
        { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/acpi.md', content: '# ACPI\n\n[src: raw/ingested/s.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/s.md', subject: 's', scope: 'source', kind: 'source' },
        { path: 'wiki/concepts/acpi.md', subject: 'acpi', scope: 'workspace', kind: 'workspace' },
      ],
    });
    // `kind: "source"` et `kind: "workspace"` ne sont pas des kinds : le
    // preprocess les coerce vers le fallback `product` (ou, mieux, les traite
    // comme absents). La valeur exacte est un détail d'implémentation ; ce qui
    // compte, c'est que le plan parse sans rejeter la source.
    expect(parsed.pages.map((page) => page.kind)).not.toContain('workspace');
    expect(parsed.pages.map((page) => page.kind)).not.toContain('source');
  });

  it('signale un split même quand le modèle colle les mots (boardaimodule)', () => {
    // Un modèle à qui on a dit "no spaces" colle les mots : `boardaimodule`.
    // `subjectsAreRelated` (leading token sur le tiret) ne le voit pas ; le
    // préfixe brut, si.
    const plan = consolidationPlanSchema.parse({
      summary: 'Produit et module collés.',
      operations: [
        { type: 'create', path: 'wiki/sources/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board-ai-module.md', content: '# Board AI\n\n[src: raw/ingested/board.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/board.md', subject: 'board', scope: 'source', kind: 'vendor' },
        { path: 'wiki/concepts/board.md', subject: 'board', scope: 'product', kind: 'product', rationale: 'Solution.' },
        { path: 'wiki/concepts/board-ai-module.md', subject: 'boardaimodule', scope: 'product', kind: 'product', rationale: 'Module.' },
      ],
    });
    const result = validateConsolidation(plan, {
      sourcePagePath: 'wiki/sources/board.md', citationPath: 'raw/ingested/board.md',
      existingPaths: new Set(), collection: null,
    });
    expect(result.warnings.some((issue) => issue.reason.includes('concept split'))).toBe(true);
  });

  it('détecte un split via detectConceptSplits et produit une consigne de fusion', () => {
    const plan = consolidationPlanSchema.parse({
      summary: 'Produit et module.',
      operations: [
        { type: 'create', path: 'wiki/sources/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board.md', content: '# Board\n\n[src: raw/ingested/board.md]\n' },
        { type: 'create', path: 'wiki/concepts/board-ai-module.md', content: '# Board AI\n\n[src: raw/ingested/board.md]\n' },
      ],
      pages: [
        { path: 'wiki/sources/board.md', subject: 'board', scope: 'source', kind: 'vendor' },
        { path: 'wiki/concepts/board.md', subject: 'board', scope: 'product', kind: 'product', rationale: 'Solution.' },
        { path: 'wiki/concepts/board-ai-module.md', subject: 'board-ai-module', scope: 'product', kind: 'product', rationale: 'Module.' },
      ],
    });
    const splits = detectConceptSplits(plan);
    expect(splits.length).toBe(1);
    expect(splits[0]).toMatchObject({
      path: 'wiki/concepts/board-ai-module.md',
      subject: 'board-ai-module',
      duplicateOfSubject: 'board',
    });

    const retry = buildConsolidationRetryUser('## Extracted facts\n- x', { splits });
    expect(retry).toContain('board-ai-module');
    expect(retry).toContain('board');
    expect(retry).toContain('Merge');
    expect(retry).toContain('## Extracted facts');
    expect(retry).toContain('source note');
  });

  it('détecte un dépassement du budget conceptuel, pas un plan dans le budget', () => {
    const plan = consolidationPlanSchema.parse({
      summary: 'Trop de concepts.',
      operations: [
        { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/a.md', content: '# A\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/b.md', content: '# B\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/c.md', content: '# C\n\n[src: raw/ingested/s.md]\n' },
        { type: 'create', path: 'wiki/concepts/d.md', content: '# D\n\n[src: raw/ingested/s.md]\n' },
      ],
    });
    const overflow = detectConceptOverflow(plan, new Set(), 3);
    expect(overflow).not.toBeNull();
    expect(overflow?.newConcepts).toBe(4);
    expect(overflow?.budget).toBe(3);

    // Un concept existant n'est pas compté comme nouveau.
    const within = detectConceptOverflow(plan, new Set(['wiki/concepts/a.md']), 3);
    expect(within).toBeNull();
  });

  it('détecte un chemin ciblé deux fois (deux update de l’index)', () => {
    const plan = consolidationPlanSchema.parse({
      summary: 'Double index.',
      operations: [
        { type: 'create', path: 'wiki/sources/s.md', content: '# S\n\n[src: raw/ingested/s.md]\n' },
        { type: 'update', path: 'wiki/index.md', content: '# Index\n\n- a' },
        { type: 'update', path: 'wiki/index.md', content: '# Index\n\n- a\n- b' },
      ],
    });
    expect(detectDuplicatePaths(plan)).toEqual(['wiki/index.md']);
  });
});

describe('cache et reprise', () => {
  it('adresse séparément lots, modèles, prompts et inventaires', () => {
    const base = {
      sourceHash: 'source', packIndex: 0, packHash: 'pack', model: 'm1',
      promptVersion: 1, schemaVersion: 1,
    };
    expect(extractionCacheName(base)).not.toBe(extractionCacheName({ ...base, packIndex: 1 }));
    expect(extractionCacheName(base)).not.toBe(extractionCacheName({ ...base, model: 'm2' }));
    const consolidation = {
      sourceHash: 'source', extractionsHash: 'extract', inventoryHash: 'inventory',
      model: 'm1', promptVersion: 1, schemaVersion: 1,
    };
    expect(consolidationCacheName(consolidation)).not.toBe(
      consolidationCacheName({ ...consolidation, inventoryHash: 'changed' }),
    );
  });

  it('relit une extraction valide après une coupure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-ingest-cache-'));
    roots.push(root);
    const cache = new IngestCache(root);
    await cache.write('extract-test.json', extraction('Anaplan'));
    const resumed = sourceExtractionSchema.parse(await cache.read('extract-test.json'));
    expect(resumed.subjects[0]?.label).toBe('Anaplan');
  });
});
