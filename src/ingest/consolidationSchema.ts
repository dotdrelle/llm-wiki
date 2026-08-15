import { z } from 'zod';
import { wikiOperationSchema } from '../config/schema.ts';
import { EXTRACTION_SCOPES } from './extractionSchema.ts';

/*
 Contrat de consolidation : une source, un plan.

 C'est ici — et seulement ici — que des faits deviennent des fichiers. Le plan
 est produit en un appel qui voit TOUTE la source, ce qui est la condition pour
 que deux fragments ne créent pas deux pages du même concept, et pour que le
 nombre de pages cesse de suivre le nombre de lots.
*/

export const CONSOLIDATION_SCHEMA_VERSION = 1;

const nonEmpty = z.string().trim().min(1);
const optionalValue = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  nonEmpty.nullish().transform((value) => value ?? null),
);

/**
 * Provenance déclarée pour une page du plan.
 *
 * Séparée des opérations : le moteur l'injecte lui-même dans le frontmatter.
 * Demander au modèle d'écrire ces champs à l'intérieur du contenu reviendrait à
 * accepter qu'ils manquent sur une page sur dix.
 */
export const consolidatedPageSchema = z.object({
  path: nonEmpty,
  subject: optionalValue,
  collection: optionalValue,
  scope: z.enum(EXTRACTION_SCOPES).nullish().transform((value) => value ?? null),
  /** Pourquoi cette page existe : ce que le journal doit pouvoir restituer. */
  rationale: optionalValue,
});

export const consolidationPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const candidate = value as Record<string, unknown>;
    const operations = candidate.operations ?? candidate.changes ?? candidate.files ?? [];
    const operationPaths = Array.isArray(operations)
      ? operations
          .filter((operation): operation is Record<string, unknown> =>
            Boolean(operation && typeof operation === 'object' && !Array.isArray(operation)))
          .map((operation) => operation.path)
      : [];
    const rawPages = candidate.pages ?? candidate.provenance ?? [];
    const pages = Array.isArray(rawPages)
      ? rawPages.map((page, index) => {
          if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
          const item = page as Record<string, unknown>;
          // Albert respecte l'ordre mais omet parfois le chemin. Cette jointure
          // n'invente aucune page : elle rattache la provenance aux opérations
          // non-index déjà déclarées dans la même réponse.
          return { ...item, path: item.path ?? operationPaths[index] };
        }).filter((page) => {
          if (!page || typeof page !== 'object' || Array.isArray(page)) return true;
          return (page as Record<string, unknown>).path !== 'wiki/index.md';
        })
      : rawPages;
    return {
      ...candidate,
      summary: candidate.summary ?? candidate.log_message ?? candidate.message,
      operations,
      pages,
    };
  },
  z.object({
    summary: z.string().default('Ingest completed.'),
    operations: z.array(wikiOperationSchema).default([]),
    pages: z.array(consolidatedPageSchema).default([]),
  }),
);

export type ConsolidatedPage = z.infer<typeof consolidatedPageSchema>;
export type ConsolidationPlan = z.infer<typeof consolidationPlanSchema>;
