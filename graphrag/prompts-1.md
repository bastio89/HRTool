Prompt 4:
Erweitere die API mit der Funktionalität dass ganze .pdf Dateien eingelesen werden können statt plain text.

Prompt 3:
schreibe mir in python eine regression test suite.

Prompt 2: 
starte den server

Prompt 1
Build a production-ready, highly efficient HR matching server in Python using FastAPI that implements a 3-stage funnel matching pipeline (M x N matching) using Neo4j and OpenAI.

Follow this architecture and structure the code into clean, modular Python modules (e.g., main.py, services/llm.py, services/db.py, models.py):

### 1. TECH STACK & LIBRARIES
- Backend Framework: FastAPI (with Uvicorn)
- Graph DB Client: neo4j (official Python driver)
- LLM / Embeddings: openai (Python SDK)
- Data Validation & Schemas: Pydantic v2 (crucial for FastAPI and OpenAI Structured Outputs)

### 2. GRAPH ONTOLOGY (Neo4j)
Implement nodes and relationships as follows:
- (:Candidate {id, name, location, experience_years, embedding})
- (:Job {id, title, department, location, embedding})
- (:Skill {name})
- (:Role {name})
- (:Branch {name})
- Edges:
  - (:Candidate)-[:HAS_SKILL {experience_years}]->(:Skill)
  - (:Job)-[:REQUIRES_SKILL {importance: 'mandatory'|'nice_to_have'}]->(:Skill)
  - (:Candidate)-[:PREFERS_ROLE]->(:Role)
  - (:Skill)-[:BELONGS_TO]->(:Role)

### 3. API ENDPOINTS & LOGIC (FastAPI)

#### POST /ingest/candidate
- Accepts raw CV text (as a string or file upload).
- Phase 1 (Parser): Use OpenAI Structured Outputs (via Pydantic models with `beta.chat.completions.parse`) to extract: Name, location, experience_years, skills (standardized), and preferred_roles.
- Phase 2 (Embedding): Create a vector embedding of the extracted structured JSON summary using `text-embedding-3-small`.
- Phase 3 (Graph Ingestion): Write/Merge nodes and relationships into Neo4j using Cypher. Store the embedding list directly on the Candidate node.

#### POST /ingest/job
- Accepts raw job description.
- Phase 1 (Parser): Use OpenAI Structured Outputs to extract: Title, department, location, required skills (importance: mandatory/nice_to_have).
- Phase 2 (Embedding): Create a vector embedding of the structured JSON.
- Phase 3 (Graph Ingestion): Write to Neo4j. Store the embedding list on the Job node.

#### POST /match/{job_id}
Implement the 3-Stage Funnel to find matching candidates for a specific Job ID:

- **Stage 1: Hard Filtering (Cypher Query)**
  Filter candidates who share at least 1 mandatory skill with the job (or match location/role preference).
  *Target output size: Top 100 Candidates.*

- **Stage 2: Semantic Vector Search & Graph Metrics (Neo4j)**
  Perform a Cosine Similarity Search using Neo4j's built-in vector index, comparing the Job's embedding against the Stage 1 filtered Candidates. Combine this scoring with a simple Jaccard Similarity score of matching skills.
  *Target output size: Top 10 Candidates.*

- **Stage 3: LLM Re-Ranking**
  Send the structured profiles of the Top 10 candidates + the Job Profile to OpenAI (`gpt-4o-mini`).
  Use a Pydantic model to guarantee a structured response: a list of candidates, each with a score (1-100) and a concise, 2-sentence explanation of why they fit.
  *Target output: Sorted list of Top 10 candidates with score and explanation.*

### 4. CODE QUALITY & SETUP REQUIREMENTS
- Use async/await for FastAPI endpoints and database/LLM calls where applicable.
- Define explicit Pydantic schemas for all request payloads, response bodies, and OpenAI extraction structures.
- Handle environment variables (`NEO4J_URI`, `NEO4J_PASSWORD`, `OPENAI_API_KEY`) using `pydantic-settings`.
- Provide a Python initialization script to create the Neo4j Vector Index and Constraints if they don't exist yet.