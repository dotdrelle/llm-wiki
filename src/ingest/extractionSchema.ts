import { z } from 'zod';

/*
 Contrat d'extraction : un lot rapporte des FAITS, jamais des fichiers.

 Avant, chaque lot d'une source recevait le prompt d'ingestion complet et
 décidait seul de créer des pages, d'en mettre à jour et de toucher l'index.
 Les opérations étaient ensuite concaténées sans consolidation sémantique : deux
 lots pouvaient écrire le même chemin, ou deux chemins différents pour le même
 concept, et rien ne les départageait. Le nombre de pages produites suivait donc
 le nombre de lots — c'est-à-dire le découpage des titres.

 Ici, un lot ne peut rien écrire. Il rapporte ce qu'il a lu, avec des
 identifiants LOCAUX au document ; la consolidation seule transforme cela en
 chemins. C'est ce qui rend la décision unique par source au lieu d'être répétée
 par fragment.
*/

/** Version du contrat, portée par le cache : un changement invalide les entrées. */
export const EXTRACTION_SCHEMA_VERSION = 1;

/**
 * Portée d'un sujet candidat.
 *
 * `source` reste dans la note de source ; `product` appartient à un sujet
 * comparé ; `transverse` traverse plusieurs sujets ; `workspace` vaut pour tout
 * l'espace de travail. C'est cette portée, et non le volume de texte, qui décide
 * plus tard si un candidat mérite sa page.
 */
export const EXTRACTION_SCOPES = ['source', 'product', 'transverse', 'workspace'] as const;
export type ExtractionScope = (typeof EXTRACTION_SCOPES)[number];

/**
 * Importance déclarée, avec sa justification.
 *
 * Demander la justification n'est pas décoratif : c'est ce qui permet à la
 * consolidation de refuser un candidat sans avoir à relire le fragment, et au
 * journal d'expliquer après coup pourquoi un concept a été gardé.
 */
export const EXTRACTION_IMPORTANCE = ['core', 'supporting', 'incidental'] as const;

const nonEmpty = z.string().trim().min(1);

/** Identifiant local au document : `s1`, `s2`… Jamais un chemin. */
const localId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/i, 'identifiant local attendu, jamais un chemin');

export const extractedFactSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const fact = value as Record<string, unknown>;
  const triple = fact.predicate !== undefined && fact.object !== undefined
    ? `${String(fact.subject ?? 'subject')} ${String(fact.predicate)}: ${
        Array.isArray(fact.object) ? fact.object.map(String).join(', ') : String(fact.object)
      }`
    : undefined;
  return {
    ...fact,
    statement: fact.statement ?? fact.text ?? fact.content ?? fact.claim ?? triple,
    subject: fact.subject ?? fact.subjectId ?? fact.subject_id,
  };
}, z.object({
  statement: nonEmpty,
  /** Sujet local auquel le fait se rattache, quand il y en a un. */
  subject: localId.nullish().transform((value) => value ?? null),
  /** Chemin de citation canonique, tel que fourni dans le message utilisateur. */
  citation: nonEmpty,
}));

export const extractedSubjectSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const subject = value as Record<string, unknown>;
  return {
    ...subject,
    // Certains moteurs omettent le libellé mais fournissent id + portée +
    // justification. L'id reste alors un repère PRIVÉ pour la consolidation,
    // jamais un nom de page ni une identité publiée.
    label: subject.label ?? subject.name ?? subject.title ?? subject.id,
    rationale: subject.rationale ?? subject.justification ?? subject.reason ?? subject.why,
    relatedExistingPages:
      subject.relatedExistingPages ?? subject.existingPages ?? subject.related_pages ?? [],
  };
}, z.object({
  id: localId,
  label: nonEmpty,
  scope: z.enum(EXTRACTION_SCOPES),
  importance: z.enum(EXTRACTION_IMPORTANCE).default('supporting'),
  rationale: nonEmpty,
  /**
   * Pages existantes que ce candidat pourrait prolonger.
   *
   * Un SIGNAL de rapprochement, pas une décision : la consolidation vérifie que
   * la page existe et tranche. Sans ce signal, chaque lot redécouvrait un
   * concept déjà écrit et la consolidation n'avait aucune raison de les
   * rapprocher.
   */
  relatedExistingPages: z.array(nonEmpty).default([]),
}));

export const extractedRelationSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const relation = value as Record<string, unknown>;
  return {
    ...relation,
    from: relation.from ?? relation.source ?? relation.sourceId
      ?? relation.fromSubject ?? relation.sourceSubject ?? relation.subject1 ?? relation.subject,
    to: relation.to ?? relation.target ?? relation.targetId
      ?? relation.toSubject ?? relation.targetSubject ?? relation.subject2 ?? relation.object,
    kind: relation.kind ?? relation.type ?? relation.relation ?? relation.predicate,
  };
}, z.object({
  from: localId,
  to: localId,
  kind: nonEmpty,
}));

/*
 Tolérance d'entrée, même discipline que `ingestPlanSchema`.

 Les modèles renomment volontiers les clés d'un tour à l'autre. Réparer ici ce
 qui est manifestement le même champ évite un rejet — et donc un appel de plus —
 pour une différence de vocabulaire qui ne change aucun sens.
*/
export const sourceExtractionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const candidate = value as Record<string, unknown>;
    const rawSubjects = Array.isArray(candidate.subjects ?? candidate.candidates ?? candidate.topics)
      ? (candidate.subjects ?? candidate.candidates ?? candidate.topics) as unknown[]
      : [];
    const declaredMain = candidate.mainSubject ?? candidate.main_subject ?? candidate.primarySubject ?? null;
    const resolvedMain = typeof declaredMain === 'string'
      ? rawSubjects.find((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
          const subject = raw as Record<string, unknown>;
          const label = subject.label ?? subject.name ?? subject.title;
          return typeof label === 'string'
            && label.trim().localeCompare(declaredMain.trim(), undefined, { sensitivity: 'base' }) === 0;
        })
      : null;
    return {
      ...candidate,
      facts: candidate.facts ?? candidate.statements ?? candidate.findings ?? [],
      subjects: candidate.subjects ?? candidate.candidates ?? candidate.topics ?? [],
      relations: candidate.relations ?? candidate.links ?? [],
      mainSubject: resolvedMain && typeof resolvedMain === 'object'
        ? (resolvedMain as Record<string, unknown>).id
        : declaredMain,
    };
  },
  z.object({
    facts: z.array(extractedFactSchema).default([]),
    subjects: z.array(extractedSubjectSchema).default([]),
    relations: z.array(extractedRelationSchema).default([]),
    /** Identité du sujet principal quand elle est explicite dans le fragment. */
    mainSubject: localId.nullish().transform((value) => value ?? null),
  }).superRefine((extraction, context) => {
    const ids = new Set(extraction.subjects.map((subject) => subject.id));
    const duplicateIds = extraction.subjects
      .map((subject) => subject.id)
      .filter((id, index, all) => all.indexOf(id) !== index);
    for (const id of new Set(duplicateIds)) {
      context.addIssue({ code: 'custom', path: ['subjects'], message: `identifiant local en double : ${id}` });
    }
    extraction.facts.forEach((fact, index) => {
      if (fact.subject && !ids.has(fact.subject)) {
        context.addIssue({ code: 'custom', path: ['facts', index, 'subject'], message: `sujet local inconnu : ${fact.subject}` });
      }
    });
    extraction.relations.forEach((relation, index) => {
      if (!ids.has(relation.from)) {
        context.addIssue({ code: 'custom', path: ['relations', index, 'from'], message: `sujet local inconnu : ${relation.from}` });
      }
      if (!ids.has(relation.to)) {
        context.addIssue({ code: 'custom', path: ['relations', index, 'to'], message: `sujet local inconnu : ${relation.to}` });
      }
    });
    if (extraction.mainSubject && !ids.has(extraction.mainSubject)) {
      context.addIssue({ code: 'custom', path: ['mainSubject'], message: `sujet principal inconnu : ${extraction.mainSubject}` });
    }
  }),
);

export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractedSubject = z.infer<typeof extractedSubjectSchema>;
export type ExtractedRelation = z.infer<typeof extractedRelationSchema>;
export type SourceExtraction = z.infer<typeof sourceExtractionSchema>;

/**
 * Fusionne les extractions d'une même source, sans rien décider.
 *
 * Les identifiants sont locaux au LOT, pas au document : deux lots peuvent tous
 * deux nommer `s1`. On les préfixe donc par leur index de lot avant de les
 * réunir, sinon la consolidation verrait un seul sujet là où il y en a deux — ou
 * pire, relierait des faits appartenant à des sujets différents.
 *
 * Aucun rapprochement sémantique ici : c'est le travail de la consolidation, et
 * le faire en deux endroits reviendrait à le faire deux fois différemment.
 */
export function mergeExtractions(extractions: SourceExtraction[]): SourceExtraction {
  const facts: ExtractedFact[] = [];
  const subjects: ExtractedSubject[] = [];
  const relations: ExtractedRelation[] = [];
  const mainSubjects: string[] = [];

  extractions.forEach((extraction, index) => {
    const qualify = (id: string) => `b${index + 1}_${id}`;
    for (const fact of extraction.facts) {
      facts.push({ ...fact, subject: fact.subject ? qualify(fact.subject) : null });
    }
    for (const subject of extraction.subjects) {
      subjects.push({ ...subject, id: qualify(subject.id) });
    }
    for (const relation of extraction.relations) {
      relations.push({ ...relation, from: qualify(relation.from), to: qualify(relation.to) });
    }
    if (extraction.mainSubject) mainSubjects.push(qualify(extraction.mainSubject));
  });

  return {
    facts,
    subjects,
    relations,
    // Plusieurs lots peuvent désigner un sujet principal ; le premier déclaré
    // fait foi, et la consolidation voit de toute façon la liste complète.
    mainSubject: mainSubjects[0] ?? null,
  };
}
