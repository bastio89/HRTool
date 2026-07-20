from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from neo4j import AsyncGraphDatabase

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings


CONSTRAINTS = [
    "CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS FOR (c:Candidate) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT job_id_unique IF NOT EXISTS FOR (j:Job) REQUIRE j.id IS UNIQUE",
    "CREATE CONSTRAINT skill_name_unique IF NOT EXISTS FOR (s:Skill) REQUIRE s.name IS UNIQUE",
    "CREATE CONSTRAINT language_name_unique IF NOT EXISTS FOR (l:Language) REQUIRE l.name IS UNIQUE",
    "CREATE CONSTRAINT industry_name_unique IF NOT EXISTS FOR (i:Industry) REQUIRE i.name IS UNIQUE",
    (
        "CREATE CONSTRAINT education_unique IF NOT EXISTS "
        "FOR (e:Education) REQUIRE (e.level, e.fieldOfStudy) IS UNIQUE"
    ),
    "CREATE CONSTRAINT role_name_unique IF NOT EXISTS FOR (r:Role) REQUIRE r.name IS UNIQUE",
]

INDEXES = [
    (
        "CREATE VECTOR INDEX candidate_embedding_index IF NOT EXISTS "
        "FOR (c:Candidate) ON (c.embedding) "
        "OPTIONS {indexConfig: {`vector.dimensions`: $dimensions, `vector.similarity_function`: 'cosine'}}"
    ),
    (
        "CREATE VECTOR INDEX job_embedding_index IF NOT EXISTS "
        "FOR (j:Job) ON (j.embedding) "
        "OPTIONS {indexConfig: {`vector.dimensions`: $dimensions, `vector.similarity_function`: 'cosine'}}"
    ),
    (
        "CREATE VECTOR INDEX skill_embeddings_index IF NOT EXISTS "
        "FOR (s:Skill) ON (s.embedding) "
        "OPTIONS {indexConfig: {`vector.dimensions`: $dimensions, `vector.similarity_function`: 'cosine'}}"
    ),
]


async def init_schema() -> None:
    driver = AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )

    try:
        async with driver.session() as session:
            for statement in CONSTRAINTS:
                result = await session.run(statement)
                await result.consume()
            for statement in INDEXES:
                result = await session.run(statement, dimensions=settings.embedding_dimensions)
                await result.consume()
        print("Neo4j constraints and indexes initialized.")
    finally:
        await driver.close()


if __name__ == "__main__":
    asyncio.run(init_schema())
