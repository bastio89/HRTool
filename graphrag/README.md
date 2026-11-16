
---
# HR Graph Matching API

Production-oriented FastAPI backend for M x N candidate-job matching with a 3-stage funnel:
1. Hard filter in Neo4j graph
2. Vector similarity + Jaccard scoring
3. LLM re-ranking with structured outputs

## Stack
- FastAPI + Uvicorn
- Neo4j official Python driver (async)
- OpenRouter for hosted LLM access, with Ollama as optional local fallback
- Pydantic v2 + pydantic-settings

## Project structure
- `main.py`: FastAPI app and routes
- `models.py`: Pydantic request/response and structured output schemas
- `config.py`: Environment settings
- `services/db.py`: Async Neo4j read/write and funnel stages
- `services/llm.py`: Structured extraction, embeddings, and reranking
- `scripts/init_neo4j.py`: Creates constraints and vector indexes

## Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

The batch importer reads host, provider, chat model, embedding model, and reasoning settings exclusively from the shared database settings written by the GUI.

```bash
ollama pull <chat-model-from-gui>
ollama pull <embedding-model-from-gui>
```

## Initialize database
```bash
python scripts/init_neo4j.py
```

## Run API
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Endpoints
 `POST /cv-parser/parse?persist=false` (multipart field `file`, up to 10 PDF, DOC, DOCX, PNG, JPEG or WebP files; set `persist=true` to store the candidate in Neo4j)

### Skill-Matching

`POST /match/skills` bewertet jede Anforderung gerichtet gegen den besten vorhandenen Kandidaten-Skill. Der Endpunkt nutzt den lokalen ESCO-Katalog und das konfigurierte Embedding-Modell; eine leere `has_skills`-Liste ist zulässig, `need_skills` muss mindestens einen Eintrag enthalten.

```json
{
  "need_skills": [
    {"name": "Python programming", "priority": "mandatory"},
    {"name": "Cloud deployment", "priority": "nice_to_have"}
  ],
  "has_skills": ["Python", "AWS deployment"]
}
```

Jeder Treffer enthält den besten Kandidaten-Skill, ESCO-Auflösung, rohe und gewertete Ähnlichkeit, Abdeckungsstatus und Begründung. `qualified` berücksichtigt das Muss-Skill-Gate; `missing_skills` benennt ungedeckte Anforderungen samt Grund.

```json
{
  "score": 67,
  "qualified": true,
  "cutoff": 0.75,
  "matches": [
    {
      "need_skill": "Python programming",
      "need_esco_uri": "http://data.europa.eu/esco/skill/...",
      "need_resolution_status": "resolved",
      "has_skill": "Python",
      "has_esco_uri": "http://data.europa.eu/esco/skill/...",
      "has_resolution_status": "resolved",
      "similarity": 1.0,
      "weighted_similarity": 1.0,
      "priority": "mandatory",
      "covered": true,
      "match_type": "canonical",
      "reason": "Identische kanonische ESCO-URI."
    }
  ],
  "missing_skills": [
    {
      "name": "Cloud deployment",
      "priority": "nice_to_have",
      "reason": "Semantische Ähnlichkeit 0.0000 liegt unter dem Cutoff 0.75."
    }
  ]
}
```

## Graph schema (Neo4j)

### Core nodes
- `Candidate`
	- properties: `id`, `name`, `location`, `experience_years`, `yearsOfExperience`, `salaryExpectation`, `embedding`
- `Job`
	- properties: `id`, `title`, `company`, `department`, `location`, `employmentType`, `embedding`

### Bridge nodes
- `Skill`
	- properties: `name`, `category`
- `Language`
	- properties: `name`
- `Education`
	- properties: `level`, `fieldOfStudy`
- `Industry`
	- properties: `name`

### Relationships
- `(Candidate)-[:HAS_SKILL {yearsOfExperience, level}]->(Skill)`
- `(Job)-[:REQUIRES_SKILL {priority}]->(Skill)`
- `(Candidate)-[:SPEAKS {level}]->(Language)`
- `(Job)-[:REQUIRES_LANGUAGE {level}]->(Language)`
- `(Candidate)-[:HAS_DEGREE]->(Education)`
- `(Job)-[:REQUIRES_DEGREE]->(Education)`
- `(Candidate)-[:HAS_INDUSTRY]->(Industry)`
- `(Job)-[:IN_INDUSTRY]->(Industry)`

### Initialize / refresh schema
Run the schema initializer after model changes:

```bash
python scripts/init_neo4j.py
```

### Cypher examples

Show one candidate-job subgraph with shared bridge nodes:

```cypher
MATCH (c:Candidate)-[hs:HAS_SKILL]->(s:Skill)<-[rs:REQUIRES_SKILL]-(j:Job)
OPTIONAL MATCH (c)-[sp:SPEAKS]->(l:Language)<-[rl:REQUIRES_LANGUAGE]-(j)
OPTIONAL MATCH (c)-[:HAS_DEGREE]->(e:Education)<-[:REQUIRES_DEGREE]-(j)
OPTIONAL MATCH (c)-[:HAS_INDUSTRY]->(i:Industry)<-[:IN_INDUSTRY]-(j)
WITH c, j,
	 collect(DISTINCT {skill: s.name, candidateLevel: hs.level, candidateYears: hs.yearsOfExperience, jobPriority: rs.priority}) AS shared_skills,
	 collect(DISTINCT {language: l.name, candidateLevel: sp.level, requiredLevel: rl.level}) AS shared_languages,
	 collect(DISTINCT {degreeLevel: e.level, field: e.fieldOfStudy}) AS shared_degrees,
	 collect(DISTINCT i.name) AS shared_industries
RETURN c.id AS candidate_id,
	   c.name AS candidate_name,
	   j.id AS job_id,
	   j.title AS job_title,
	   j.company AS company,
	   shared_skills,
	   shared_languages,
	   shared_degrees,
	   shared_industries
LIMIT 1;
```

Find top candidate-job pairs by number of mandatory shared skills:

```cypher
MATCH (j:Job)-[rs:REQUIRES_SKILL {priority: 'Mandatory'}]->(s:Skill)<-[:HAS_SKILL]-(c:Candidate)
WITH j, c, count(DISTINCT s) AS mandatory_skill_overlap
WHERE mandatory_skill_overlap > 0
RETURN j.id AS job_id,
	   j.title AS job_title,
	   c.id AS candidate_id,
	   c.name AS candidate_name,
	   mandatory_skill_overlap
ORDER BY mandatory_skill_overlap DESC, job_id, candidate_id
LIMIT 25;
```

## Tests
```bash
/Users/pak/HRGraphRAG/.venv/bin/python -m pytest -q
```

## Batch import CV PDFs
The helper script `graphrag/batch_tools/import_cvs_from_pdfs.py` extracts text from each PDF locally and ingests CVs directly into Neo4j.
It uses the resolved AI provider from `config.py`, so with `AI_PROVIDER=openrouter` it will call OpenRouter instead of a local Ollama instance.

- `--mode cv` imports CVs directly into Neo4j and prints the best job matches (default)
- `--mode job` parses job profiles locally and stores job skills directly in Neo4j, then prints the best candidate matches
- CV imports skip duplicates by hashing the extracted text.
- After each CV import the script prints the 10 best matching jobs based on skill overlap in Neo4j.

```bash
/Users/pak/HRGraphRAG/.venv/bin/python graphrag/batch_tools/import_cvs_from_pdfs.py \
	--api-base http://localhost:8000 \
	--mode cv \
	--input-dir cv_input
```

OpenRouter example:

```bash
export AI_PROVIDER=openrouter
export OPENROUTER_API_KEY=your_openrouter_api_key
/Users/pak/HRGraphRAG/.venv/bin/python graphrag/batch_tools/import_cvs_from_pdfs.py \
	--mode cv \
	--input-dir cv_input
```

Dry-run (only local PDF extraction, no API ingest, no file move):

```bash
/Users/pak/HRGraphRAG/.venv/bin/python graphrag/batch_tools/import_cvs_from_pdfs.py \
	--api-base http://localhost:8000 \
	--mode job \
	--input-dir job_input \
	--dry-run
```

Real PDF + real Neo4j integration test (`tests/test_pdf_db_integration.py`) only runs when valid Neo4j credentials are set in the shell environment, e.g.:
```bash
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=your_real_password
/Users/pak/HRGraphRAG/.venv/bin/python -m pytest -q tests/test_pdf_db_integration.py
```

Wenn der Graphrag-Server gegen den Neo4j-Container aus dem Hauptprojekt laufen soll, verwenden Sie stattdessen `NEO4J_URI=bolt://neo4j:7687` und denselben `NEO4J_PASSWORD` wie in der Compose-Datei.

## ESCO-Katalog importieren
Als ausgewählter Stand ist ESCO 1.2.1 vorgesehen (veröffentlicht im Dezember 2025). Der offizielle Download bietet sprachspezifische CSV-Dateien wie `skills_en.csv` und `skills_de.csv` sowie eine `dictionary`-Datei mit nicht bevorzugten Bezeichnungen. Siehe [ESCO v1.2.1](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-v121) und [Dateistruktur der Downloads](https://esco.ec.europa.eu/en/structure-esco-downloadable-datasets).

| Voraussetzung | Vorgehen |
|---|---|
| Download | CSV-Dateien für die gewünschten Sprachen aus dem offiziellen ESCO-Downloadportal lokal in ein Verzeichnis legen. Erwartet werden `skills_<sprache>.csv` sowie `dictionary_<sprache>.csv` oder `dictionary.csv`. |
| Lizenzprüfung | Der [ESCO-Datensatz im Datenportal](https://data.europa.eu/88u/dataset/european-skills-competences-qualifications-and-occupations) weist für die Klassifikations-Distribution `COM_REUSE` aus. Der Katalogeintrag bindet diese Angabe nicht ausdrücklich an eine bestimmte Version oder das konkrete Archiv; Nachweis und Einschränkung stehen in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Vor produktiver Nutzung sind individuelle Hinweise und Rechte Dritter zu beachten. ESCO-Daten werden nicht mit dem Repository ausgeliefert. |
| Testlauf | `python scripts/import_esco.py --input-dir /pfad/zu/esco-csv --release 1.2.1 --languages en,de --dry-run` prüft Dateien und zählt importierbare Skills, ohne Neo4j zu verbinden. |
| Import/Aktualisierung | Nach erfolgreicher Lizenzprüfung und laufendem Neo4j denselben Befehl ohne `--dry-run` ausführen. `ESCOConcept`-Knoten werden anhand ihrer URI idempotent aktualisiert und mit passenden bestehenden `Skill`-Knoten verknüpft. |

Der Import übernimmt URI, bevorzugte Bezeichnung, Definition, Sprachvarianten und Wörterbuchterme. Mehrdeutige Aliase werden beim Auflösen nicht willkürlich einem Konzept zugeordnet; unbekannte Bezeichnungen bleiben unaufgelöst. Für eine neue ESCO-Veröffentlichung zuerst deren Lizenz und CSV-Struktur prüfen, danach `--release` mit der Versionskennung setzen und den Import erneut ausführen.

Das in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) dokumentierte JSON-LD-Archiv dient dem Quellen- und Lizenznachweis; der Importer verarbeitet CSV-Exporte und liest dieses ZIP nicht direkt.

## Skill-Matching-Score

| Regel | Verhalten |
|---|---|
| Cutoff | `SKILL_MATCHING_CUTOFF`, Standard `0.75`; Werte darunter zählen als `0`. |
| Volltrefferbereich | Ähnlichkeiten ab `0.90` werden für den Score auf `1.0` begrenzt; dazwischen zählt der Messwert. |
| Gewichtung | Muss-Skills zählen mit Gewicht `2`, Nice-to-have-Skills mit Gewicht `1`; der Score ist der gewichtete Durchschnitt von `0` bis `100`. |
| Muss-Skill-Gate | Ein nicht abgedeckter Muss-Skill setzt `qualified` auf `false` und den Gesamtscore auf `0`; Nice-to-have-Lücken lösen kein Gate aus. |

ESCO-URIs liefern kanonische Treffer. Andere Paare werden anhand der bevorzugten ESCO-Bezeichnung und Beschreibung semantisch verglichen; semantische Ähnlichkeit wird nicht als identische kanonische URI ausgegeben.

## CSV-Regressionstest für Skill-Matching

Die Testfälle stehen in `tests/fixtures/skill_matching_cases.csv`; Skill-Listen sind JSON-Arrays innerhalb der CSV-Zellen. Der Test läuft standardmäßig nicht und benötigt einen befüllten Neo4j-ESCO-Katalog sowie die konfigurierte Embedding- und Datenbankverbindung.

```bash
RUN_SKILL_MATCHING_CSV_TESTS=1 python -m pytest -q tests/test_skill_matching_csv.py
```

Die Fälle werden zeilenweise ausgeführt. Eine Abweichung von mehr als 5 Punkten schlägt mit Testid, Soll, Ist und Differenz fehl.
