
---
# HR Graph Matching API

Production-oriented FastAPI backend for M x N candidate-job matching with a 3-stage funnel:
1. Hard filter in Neo4j graph
2. Vector similarity + Jaccard scoring
3. LLM re-ranking with structured outputs

## Stack
- FastAPI + Uvicorn
- Neo4j official Python driver (async)
- Ollama (local LLM runtime)
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

Make sure Ollama is running locally and the configured models are available, e.g. `qwen3.6:35b` for chat and `qwen3-embedding:4b` for vectorization.

```bash
ollama pull qwen3.6:35b
ollama pull qwen3-embedding:4b
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
- `POST /ingest/candidate` (JSON `{ "raw_text": "..." }` or multipart form with `raw_text` or `file`; `.pdf` CV uploads are supported)
- `POST /ingest/job` (JSON `{ "raw_text": "..." }` or multipart form with `raw_text` or `file`)
- `POST /match/{job_id}`
- `GET /health`

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
The helper script `batch_tools/import_cvs_from_pdfs.py` extracts text from each PDF locally and ingests CVs directly into Neo4j.

- `--mode cv` imports CVs directly into Neo4j and prints the best job matches (default)
- `--mode job` sends to `POST /ingest/job`
- CV imports skip duplicates by hashing the extracted text.
- After each CV import the script prints the 10 best matching jobs based on skill overlap in Neo4j.

```bash
/Users/pak/HRGraphRAG/.venv/bin/python batch_tools/import_cvs_from_pdfs.py \
	--api-base http://localhost:8000 \
	--mode cv \
	--input-dir cv_input
```

Dry-run (only local PDF extraction, no API ingest, no file move):

```bash
/Users/pak/HRGraphRAG/.venv/bin/python batch_tools/import_cvs_from_pdfs.py \
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
