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
import { validateConsolidation } from '../src/ingest/validateConsolidation.ts';

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
  it('refuse chemins locaux implicites et références à des sujets inconnus', () => {
    expect(sourceExtractionSchema.safeParse({
      facts: [{ statement: 'Fait', subject: 'absent', citation: 'raw/ingested/a.md' }],
      subjects: [{ id: 'wiki/concepts/a.md', label: 'A', scope: 'product', rationale: 'x' }],
      relations: [],
      mainSubject: 'absent',
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
        { path: 'wiki/concepts/anaplan.md', subject: 'Anaplan', scope: 'product', rationale: 'Sujet comparé.' },
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
      subject: 'anaplan', collection: 'solutions-externes', scope: 'product',
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
    expect(result.errors.some((issue) => issue.reason.includes('secondaire'))).toBe(true);
    expect(result.errors.some((issue) => issue.reason.includes('double'))).toBe(true);
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
