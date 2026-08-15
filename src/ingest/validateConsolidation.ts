import type { WikiOperation } from '../types.ts';
import type { ConsolidationPlan } from './consolidationSchema.ts';
import {
  applyProvenance,
  isValidProvenanceValue,
  normalizeProvenanceValue,
  type PageProvenance,
} from './provenance.ts';

/*
 Contrôle déterministe du plan consolidé.

 La validation répond « ce plan est-il applicable ? » ; le budget répond « cette
 granularité est-elle défendable ? ». Les deux sont séparés à dessein : une
 erreur structurelle doit bloquer, une réserve sémantique doit être visible sans
 empêcher de publier — c'est déjà la discipline de la taxonomie, et l'appliquer
 ici évite qu'un plan parfaitement utile soit rejeté pour un concept de trop.
*/

/** Budget par défaut : une note de source, plus zéro à trois concepts propres. */
export const DEFAULT_CONCEPT_BUDGET = 3;

export type ConsolidationIssue = { path: string; reason: string };

export type ValidatedConsolidation = {
  operations: WikiOperation[];
  /** Bloquant : le plan n'est pas applicable en l'état. */
  errors: ConsolidationIssue[];
  /** Observable : publié, jamais bloquant. */
  warnings: ConsolidationIssue[];
  provenanceByPath: Map<string, PageProvenance>;
};

const CONCEPT_PREFIX = 'wiki/concepts/';

function isSourceNote(path: string, sourcePagePath: string): boolean {
  return path === sourcePagePath;
}

/**
 * Valide, annote et rend le plan applicable.
 *
 * Les opérations ne sont pas réécrites au-delà de l'injection de provenance :
 * réparer un plan douteux en silence produirait une page que personne n'a
 * décidée, et masquerait précisément ce que le journal doit pouvoir expliquer.
 */
export function validateConsolidation(
  plan: ConsolidationPlan,
  context: {
    sourcePagePath: string;
    citationPath: string;
    existingPaths: Set<string>;
    collection: string | null;
    conceptBudget?: number;
  },
): ValidatedConsolidation {
  const errors: ConsolidationIssue[] = [];
  const warnings: ConsolidationIssue[] = [];
  const budget = context.conceptBudget ?? DEFAULT_CONCEPT_BUDGET;

  /*
   `pages` peut manquer : plan relu d'un cache, réponse d'un modèle avare, format
   antérieur. L'absence de provenance est une réserve — elle est signalée page par
   page plus bas — jamais une raison de perdre une source entière.
  */
  const declaredPages = plan.pages ?? [];
  const provenanceInput = new Map(declaredPages.map((page) => [page.path, page]));
  const provenanceByPath = new Map<string, PageProvenance>();

  /*
   Une source produit UNE note de source.

   Sans ce contrôle, le défaut d'origine revient sous une autre forme : la
   consolidation peut proposer une note par fragment si le prompt l'y invite,
   et la couverture du document se disperse à nouveau.
  */
  const sourceNotes = plan.operations.filter(
    (operation) => isSourceNote(operation.path, context.sourcePagePath) && operation.type !== 'delete',
  );
  if (sourceNotes.length === 0) {
    errors.push({ path: context.sourcePagePath, reason: 'aucune note de source dans le plan' });
  } else if (sourceNotes.length > 1) {
    errors.push({
      path: context.sourcePagePath,
      reason: `${sourceNotes.length} notes de source pour un document`,
    });
  }
  for (const operation of plan.operations) {
    if (operation.path.startsWith('wiki/sources/')
      && operation.path !== context.sourcePagePath
      && operation.type !== 'delete') {
      errors.push({
        path: operation.path,
        reason: `note de source secondaire interdite ; chemin canonique attendu : ${context.sourcePagePath}`,
      });
    }
  }

  const seen = new Map<string, WikiOperation>();
  const operations: WikiOperation[] = [];
  let newConcepts = 0;

  for (const operation of plan.operations) {
    const at = operation.path;

    /*
     Deux opérations contradictoires sur le même chemin.

     Le chemin précédent concaténait les opérations de chaque lot : deux
     créations du même fichier s'écrasaient en silence, et la dernière gagnait
     sans que rien ne dise laquelle. Une collision est désormais une erreur, pas
     un arbitrage implicite.
    */
    const previous = seen.get(at);
    if (previous) {
      errors.push({ path: at, reason: `chemin en double dans le plan (${previous.type} puis ${operation.type})` });
      continue;
    }
    seen.set(at, operation);

    if (operation.type !== 'delete' && !operation.content?.trim()) {
      errors.push({ path: at, reason: 'contenu vide pour une création ou une mise à jour' });
      continue;
    }

    /*
     Toute affirmation doit citer la source ingérée.

     Contrôlé sur la note de source et les concepts, pas sur l'index : l'index
     est une table des matières, pas un porteur de faits.
    */
    if (operation.type !== 'delete' && at !== 'wiki/index.md') {
      if (!operation.content?.includes(context.citationPath)) {
        warnings.push({ path: at, reason: 'aucune citation de la source ingérée' });
      }
    }

    const isNewConcept = at.startsWith(CONCEPT_PREFIX)
      && operation.type === 'create'
      && !context.existingPaths.has(at);
    if (isNewConcept) newConcepts += 1;

    const declared = provenanceInput.get(at);
    if (operation.type !== 'delete' && at !== 'wiki/index.md') {
      if (!declared) {
        warnings.push({ path: at, reason: 'provenance non déclarée' });
      }
      const subject = declared?.subject ? normalizeProvenanceValue(declared.subject) : null;
      const collection = declared?.collection
        ? normalizeProvenanceValue(declared.collection)
        : context.collection;
      const provenance: PageProvenance = {
        subject: subject && isValidProvenanceValue(subject) ? subject : null,
        collection: collection && isValidProvenanceValue(collection) ? collection : null,
        scope: declared?.scope ?? null,
      };
      if (declared?.subject && !provenance.subject) {
        warnings.push({ path: at, reason: `sujet non normalisable : « ${declared.subject} »` });
      }
      provenanceByPath.set(at, provenance);
      operations.push({
        ...operation,
        content: applyProvenance(operation.content ?? '', provenance),
      });
      continue;
    }

    operations.push(operation);
  }

  /*
   Budget conceptuel : une réserve, pas un couperet.

   Refuser le plan ferait perdre une source entière pour un concept de trop.
   L'écart est donc publié, avec son compte, et reste explicable dans le journal.
  */
  if (newConcepts > budget) {
    const justified = declaredPages.filter(
      (page) => page.path.startsWith(CONCEPT_PREFIX) && page.rationale,
    ).length;
    warnings.push({
      path: 'plan',
      reason: `${newConcepts} nouveaux concepts pour un budget de ${budget}`
        + ` (${justified} justifié(s))`,
    });
  }

  return { operations, errors, warnings, provenanceByPath };
}
