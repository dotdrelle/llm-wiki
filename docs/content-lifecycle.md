# Cycle de vie du contenu

État : spécification, 2026-08-05. Décide ce que le moteur **doit** faire quand
une source apparaît, change, se tait ou disparaît. Rien ici n'est implémenté
sans être d'abord écrit ici.

Ce document existe parce que le wiki sait bien s'enrichir et se corriger, mais
pas encore gérer une disparition. Ajouter du code au jugé sur ce sujet
produirait trois règles d'identité incompatibles — une par ticket.

---

## 1. Deux cycles, indépendants

`ingest` met à jour le wiki. `build` / `refresh` met à jour les livrables et
**ne touche jamais au wiki** : il le lit.

```text
Sources → raw/untracked/ ──ingest──► wiki/ + raw/ingested/ ──build/refresh──► deliverables/
```

Trois rôles à ne pas confondre :

| Emplacement | Rôle |
| --- | --- |
| `raw/ingested/` | la **preuve documentaire** — le document brut, archivé tel quel |
| `wiki/sources/` | la **note de synthèse d'une source**, une par document ingéré |
| `wiki/concepts/` | la **connaissance durable**, réutilisable, potentiellement multi-source |

---

## 2. Ce que fait le moteur aujourd'hui

Vérifié dans le code, pas déduit.

### Identité d'une source = son chemin

`workspaceService.ts:541` :

```ts
const archiveRelativePath = `raw/ingested/${slugifyPath(relativeToUntracked)}`;
```

L'identité d'une source est **le chemin du fichier sous `raw/untracked/`**,
slugifié. Il n'y a pas d'identifiant amont, pas de version, pas d'empreinte
stockée.

Conséquence directe, et c'est la racine de plusieurs symptômes : **renommer ou
déplacer une page en amont crée une source nouvelle.** L'ancienne archive reste,
la nouvelle est ingérée comme un inédit, et le wiki reçoit deux fois la même
connaissance sans aucun moyen de savoir que c'en est une seule.

### « Inchangé » = identique à la copie archivée

`isSourceUnchangedSinceIngest` (`workspaceService.ts:564`) compare la taille en
octets, puis le contenu complet, à l'archive de **même chemin**. Identique ⇒
`unchanged since last ingest`, aucun appel LLM, la source est simplement
ré-archivée.

C'est correct et efficace. Cela ne dit rien d'une source qui a changé de nom.

### La réconciliation est confiée au LLM

Une source modifiée repasse dans l'ingestion. Le LLM reçoit la nouvelle version
et les pages apparentées, et rend un plan `create` / `update` / `delete`. Chaque
`update` doit porter **le contenu final complet** du fichier.

Le moteur applique ce plan de façon atomique. Il ne vérifie pas que le plan est
cohérent avec ce qui a disparu de la source : **rien ne garantit un `delete`**.

### Les marqueurs de provenance sont écrasés à chaque ingestion

`enforceSourceCitationPath` (`ingestService.ts:108`) :

```ts
if (cleanCitationPath === archiveCitationPath) return match;
rewrittenCitations += 1;
return `[src: ${archiveCitationPath}]`;
```

Tout marqueur `[src: …]` qui ne désigne pas la source **courante** est réécrit
vers elle. L'intention est bonne — empêcher un modèle d'inventer un chemin
d'archive. L'effet de bord ne l'est pas : puisqu'un `update` porte le contenu
complet de la page, **les marqueurs hérités d'autres sources sont réattribués à
la source en cours**.

> C'est le point le plus important de ce document. La provenance par
> affirmation existe dans le format, mais elle est détruite dès qu'une deuxième
> source touche une page. Aucune fonctionnalité de retrait partiel ne peut être
> construite avant d'avoir corrigé cela.

### Le build est incrémental par template, pas par dépendance

Trois empreintes : `templateHash`, `wikiHash`, `buildContextHash`
(`schema.ts:630`, `buildService.ts:1107`). `refresh` appelle
`build({ changedOnly: true })` et saute un livrable dont les trois sont
inchangées.

Mais `wikiHash` porte sur le wiki **entier** : une page de comptabilité qui
bouge fait reconstruire un livrable réseau.

### Matrice du comportement réel

| Événement | Wiki | Livrables |
| --- | --- | --- |
| Nouvelle source | Créations et mises à jour | Reconstruits si `refreshOnIngest` |
| Source identique | Aucun changement | Aucun rebuild |
| Source modifiée | Réingestion LLM | Rebuild via nouveau `wikiHash` |
| Source renommée en amont | **Ingérée comme nouvelle** — doublon | Rebuild |
| Information retirée d'une source | Suppression **possible, non garantie** | Peut reprendre l'ancien contenu |
| Source supprimée à l'origine | **Non détectée** | Potentiellement obsolètes |
| Page wiki supprimée à la main | Suppression appliquée | Rebuild au prochain refresh |
| Template modifié | Inchangé | Livrable concerné reconstruit |
| Build-context modifié | Inchangé | Templates concernés reconstruits |

---

## 3. Les trois trous

**(a) Une information retirée d'une source peut survivre.** Le format autorise
`{"type":"delete"}` et le moteur l'applique. Mais aucune règle ne dit « cette
affirmation ne venait que de cette source, elle a disparu, elle doit partir ».
Pire : la page transmise en contexte contient encore l'ancien fait, ce qui pousse
le modèle à le conserver.

```text
V1 : « Le serveur utilise PostgreSQL 14. »  → wiki : PostgreSQL 14 [src: …]
V2 : « Le serveur utilise PostgreSQL 16. »  → remplacement, généralement obtenu
V2 : plus aucune mention de PostgreSQL      → PostgreSQL 14 peut survivre indéfiniment
```

**(b) Une source supprimée à l'origine n'est pas un événement.** `ingest` ne
traite que ce qui est **présent** dans `raw/untracked/`. Il ne compare jamais un
inventaire amont à l'inventaire ingéré. Retirer une page dans Confluence ne
déclenche donc rien : ni suppression de `wiki/sources/…`, ni retrait de ses
affirmations, ni mise à jour de `wiki/index.md`, ni rebuild.

**(c) L'identité d'une source ne survit pas à un renommage.** Voir § 2. Ce trou
est la cause d'une partie des doublons attribués à la catégorisation.

---

## 4. Décisions

### 4.1 Identité d'une source

Une source est identifiée par un **`sourceId` stable, fourni par le producteur**,
et non par son chemin :

| Producteur | `sourceId` |
| --- | --- |
| CME / Confluence | `confluence:page:<pageId>` |
| Connecteur Gmail | `gmail:message:<messageId>` |
| Dépôt de fichier manuel | `file:<sha256 des 4 premiers Ko + taille>` |

Le chemin devient un **attribut** de la source, plus son identité. Un renommage
amont met à jour le chemin d'une source existante ; il n'en crée pas une
nouvelle.

Transition : les sources déjà ingérées, sans `sourceId`, en reçoivent un dérivé
de leur chemin actuel (`path:<archiveRelativePath>`). Elles restent donc
sensibles au renommage jusqu'à leur prochaine ingestion par un producteur qui
sait fournir un identifiant. **On ne réécrit pas l'historique**, on cesse d'en
créer.

### 4.2 Identité d'une page de concept

Une page de concept est identifiée par son **chemin dans `wiki/`**, et ce chemin
est stable. Renommer un concept est une opération explicite (`move`), jamais un
effet de bord d'une ingestion.

Corollaire pour T33 : deux pages qui décrivent la même chose sont un défaut à
corriger par fusion, pas un état à tolérer. La détection s'appuie d'abord sur la
**provenance partagée** (§ 4.4), ensuite seulement sur la similarité de titre —
qui produit des faux positifs sur les homonymes (ticket B17).

### 4.3 États d'une source, et transitions

```text
                    ┌──────────┐
   première vue ───►│  active  │◄──── réapparaît
                    └────┬─────┘
        absente d'un     │
        export complet   ▼
                    ┌──────────┐   confirmée par
                    │ missing  │   un 2ᵉ export ──►┌───────────┐
                    └──────────┘                   │ retracted │
                                                   └───────────┘
```

| Constat | Transition | Effet |
| --- | --- | --- |
| Source inconnue | → `active` | `ingest` |
| Contenu différent de l'archive | reste `active` | `reconcile` (ingestion) |
| Contenu identique | reste `active` | `skip` |
| Absente d'un export **déclaré complet** | `active` → `missing` | **rapport seul**, aucune écriture |
| `missing` confirmée par un second export complet | → `retracted` | **plan de retrait**, soumis à approbation |
| Réapparaît | `missing` → `active` | `reconcile` |
| Page sans source vivante | — | avertissement `orphan` |

**Deux règles non négociables :**

1. **Un export partiel ne déclenche jamais rien.** L'absence n'est un signal
   que si l'appelant déclare l'inventaire exhaustif. Sans cela, une panne réseau
   pendant un export effacerait la moitié du wiki.
2. **Le retrait est en deux temps** : détection et plan, puis validation humaine,
   puis application. Le plan passe par le même mécanisme d'approbation que les
   autres mutations Donna — pas de chemin parallèle.

### 4.4 Granularité de la provenance

**Décision : au niveau de l'affirmation, pas du fichier.**

Une page de concept peut être soutenue par plusieurs sources. Retirer une source
ne supprime pas la page : cela retire ou réévalue **les seules affirmations
exclusivement soutenues par elle**.

Cela impose de corriger `enforceSourceCitationPath` :

- un marqueur `[src: X]` où `X` désigne une **archive existante** est laissé
  intact, même si `X` n'est pas la source courante ;
- un marqueur pointant vers une archive **inexistante** est réécrit vers la
  source courante (l'intention d'origine : le modèle a inventé un chemin) ;
- un marqueur ajouté par l'opération en cours porte la source courante.

Sans ce changement, aucune des règles de retrait de ce document n'est
applicable.

### 4.5 Catégories

- Une catégorie est un **dossier sous `wiki/`**, et son identité est son chemin.
- Profondeur **bornée à deux niveaux** sous `wiki/concepts/`. Au-delà,
  l'arborescence cesse d'aider à lire et le tri devient illisible.
- Taxonomie **ouverte mais convergente** : le modèle peut proposer une nouvelle
  catégorie, une passe de fusion s'exécute ensuite et les rapproche. Une liste
  fermée serait plus simple mais ne survit pas à un corpus inconnu.
- Une page appartient à **une seule** catégorie — le chemin de fichier. Le
  multi-appartenance viendra par étiquettes si le besoin se confirme, pas par
  duplication.
- Une catégorie **vidée** est signalée, jamais supprimée automatiquement : c'est
  une intention de rangement.

### 4.6 Versions de page

Pas d'historique applicatif. `historyService` (git) **est** la réponse : chaque
ingestion produit un commit, et remonter dans le temps se fait par git.
Construire un second mécanisme de versions dupliquerait une capacité déjà
présente et testée.

---

## 5. Ce que le registre contient

`.wiki/source-registry.json`, écrit par `ingest`, lu par la réconciliation.

```json
{
  "version": 1,
  "sources": [
    {
      "sourceId": "confluence:page:12345",
      "archivePath": "raw/ingested/architecture.md",
      "contentHash": "sha256:abc…",
      "status": "active",
      "firstSeenAt": "2026-07-02T09:12:00Z",
      "lastSeenAt": "2026-08-05T10:00:00Z",
      "lastIngestedAt": "2026-08-05T10:00:00Z",
      "producedPages": [
        "wiki/sources/architecture.md",
        "wiki/concepts/infrastructure/postgresql.md"
      ]
    }
  ]
}
```

`producedPages` est renseigné à partir des opérations réellement appliquées :
c'est du fait constaté, pas une intention du modèle.

---

## 6. Découpage

| Étape | Contenu | Risque |
| --- | --- | --- |
| **T32.1** | Ce document | — |
| **T32.2** | Registre en **écriture seule**, alimenté par `ingest` | nul : rien ne le lit |
| **T32.3** | `wiki sync --manifest <fichier>` : compare, **rapporte** `missing` / `orphan`, n'écrit pas | nul : lecture seule |
| **T32.4** | Plan de retrait à partir d'un `retracted` confirmé, soumis à approbation | modéré |
| **T32.5** | Provenance par affirmation (§ 4.4) + lint des marqueurs | élevé : touche l'ingestion |
| **T32.6** | `wikiHash` par dépendance plutôt que global | isolé, parallélisable |

T32.1 → T32.4 traitent le trou **(b)**. T32.5 traite **(a)** et conditionne T33
et le ticket B17. T32.6 est indépendant.

---

## 7. Questions encore ouvertes

Aucune décision n'est prise ici ; elles sont listées pour ne pas être oubliées.

- **Qui déclare un export complet ?** Le producteur (CME sait s'il a exporté un
  espace entier), ou l'opérateur au moment de lancer la synchronisation ?
- **Combien d'exports pour confirmer une disparition ?** Deux est une intuition,
  pas une mesure.
- **Que fait-on d'une page dont toutes les sources sont `retracted` mais qui a
  été éditée à la main depuis ?** L'édition manuelle est-elle une source ?
- **Le `sourceId` d'un fichier déposé à la main** doit-il survivre à une
  modification de son contenu ? Si l'empreinte en fait partie, non — et un
  document corrigé devient une source nouvelle, ce qu'on cherche justement à
  éviter.
