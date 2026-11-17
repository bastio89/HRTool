# Schnittstellen: Skill-Abdeckung (001)

Format der Ergebnisse: siehe `../data-model.md`, Abschnitt „Ergebnis einer
Paarung“. Fehler kommen wie bisher als `{ "error": "…" }` (Backend) bzw.
`{ "detail": … }` (GraphRAG) mit Grund.

## GraphRAG

### `POST /match/vectormatch` (geändert)

Anfrage wie bisher:

```json
{ "jobIds": ["uuid"], "cvIds": ["uuid"], "engine": "python", "detail": "full" }
```

- `engine` wird angenommen, aber ignoriert (beide Werte rechnen gleich).
- `detail`: `full` (Standard) mit `matchedSkills`, `summary` ohne – für M×N.
- Kosten wie bisher (3D-Credits je Aufruf).

Antwort: wie bisher (`matrix`, `jobsRanked`, `candidatesRanked`,
`missingJobIds`, `missingCandidateIds`), jede Zeile im Format
`SkillCoverage`; zusätzlich auf oberster Ebene `scoringVersion` und
`embeddingModel`.

Fehler neu: `503` mit `{ "error": "Embeddings konnten nicht erzeugt werden", "skills": [...] }`,
wenn OpenRouter für benötigte Skills nicht antwortet – kein stilles Ersatz-Embedding.

### `POST /match/skill-coverage/explain` (neu)

```json
{ "jobId": "uuid", "candidateId": "uuid" }
```

Antwort: ein `SkillCoverage` mit `matchedSkills`. Keine Credits (reine
Erklärung eines bereits berechneten Werts).

### `GET /match/skill-coverage/version` (neu)

```json
{ "scoringVersion": "sa1-…", "embeddingVersion": "…", "embeddingModel": "baai/bge-m3",
  "thresholds": { "low": 0.72, "high": 0.9 }, "outdatedSkills": 1234 }
```

### `POST /internal/skill-coverage/recompute` (neu)

Nur mit Dienstschlüssel (`X-API-Key` = `GRAPHRAG_API_KEY`), ohne
Benutzer-JWT, ohne Credits.

```json
{ "jobId": "uuid", "candidateIds": ["uuid", "…"] }
```

Antwort: `{ "scoringVersion": "…", "results": [SkillCoverage ohne matchedSkills], "missingCandidateIds": [] }`

### `POST /match/external/run`, `/match/external/matrix`, `/match/external/matrix_neo4j` (geändert)

Rechnen über dieselbe Bewertung. Embeddings der übergebenen Skill-Namen werden
erzeugt, aber nicht in Neo4j gespeichert. Ergebnisse tragen `scoringVersion`.
Werte ändern sich gegenüber heute (gewollt; README-Hinweis).

## Backend

### `POST /api/matching/run-matrix` (geändert)

Anfrage wie bisher; `engine` wird ignoriert. Ablauf neu: fehlende Neo4j-Knoten
abgleichen, dann GraphRAG `/match/vectormatch` mit allen UUIDs und
`detail=summary`. Antwort wie bisher plus `scoringVersion`; Paarungen, die in
Neo4j fehlen, als `failures` mit Grund.

### `POST /api/matching/vectormatch`, `/vectormatch-selected` (geändert)

Unverändert bis auf: `engine` wird ignoriert; Ergebnisse und gespeicherte
Paarungen tragen `scoringVersion`.

### `GET /api/matching/skill-coverage/explain?jobId=…&candidateId=…` (neu)

PostgreSQL-IDs; Backend übersetzt in UUIDs und ruft GraphRAG auf. Antwort:
`SkillCoverage` mit `matchedSkills`.

### `/api/skill-matching` (neu, nur Admin)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/settings` | Schwellen, Gewichte, Vorlage, aktuelle `scoringVersion` |
| PUT | `/settings` | speichern (mit Prüfregeln); startet Neuberechnung |
| GET | `/synonyms` | Liste |
| POST | `/synonyms` | `{ alias, canonical }`; `409` bei doppeltem Alias |
| DELETE | `/synonyms/:id` | |
| GET | `/false-friends` | Liste |
| POST | `/false-friends` | `{ skillA, skillB }` |
| DELETE | `/false-friends/:id` | |
| GET | `/recompute` | Status: `{ running, done, total, failed, lastError }` |
| POST | `/recompute` | Neuberechnung manuell anstoßen |

Jede Änderung wird im Audit-Log festgehalten.

### Exporte

- `GET /api/crm/return/preview`, `/download`: für `method=vector` nur Paarungen
  mit aktueller `scoringVersion`; `diagnostics.outdatedPairs` zählt den Rest.
- N:N-Export `matching_vector`: dasselbe; neues Feld `scoring_version`.
