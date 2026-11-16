from __future__ import annotations

import os
import uuid

import pytest
from neo4j.exceptions import Neo4jError

from config import settings
from scripts.init_neo4j import CONSTRAINTS, INDEXES
from services.db import Neo4jService


class _FakeResult:
    async def consume(self) -> None:
        return None

    async def data(self) -> list[dict]:
        return []


class _FakeSession:
    def __init__(self, calls: list[tuple[str, dict]]) -> None:
        self.calls = calls

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    async def run(self, query: str, **params) -> _FakeResult:
        self.calls.append((query, params))
        return _FakeResult()


class _FakeDriver:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def session(self) -> _FakeSession:
        return _FakeSession(self.calls)


def test_esco_schema_has_stable_identity_and_label_lookup() -> None:
    assert any("esco_concept_uri_unique" in statement for statement in CONSTRAINTS)
    assert any("esco_concept_label_index" in statement for statement in INDEXES)


@pytest.mark.anyio
async def test_esco_concept_upsert_is_idempotent_and_preserves_existing_skills() -> None:
    service = Neo4jService(uri="bolt://unused", user="neo4j", password="unused")
    driver = _FakeDriver()
    service.driver = driver
    concept = {
        "uri": "https://example.test/esco/skill/123",
        "preferred_label": "Python",
        "aliases": ["Python programming"],
        "description": "Programmiersprache Python verwenden",
        "release": "test-release",
    }

    await service.upsert_esco_concepts([concept])
    await service.upsert_esco_concepts([concept])

    assert len(driver.calls) == 2
    for query, params in driver.calls:
        assert "MERGE (canonical:ESCOConcept {uri: concept.uri})" in query
        assert "MATCH (skill:Skill {name: normalized_label})" in query
        assert "MERGE (skill)-[:CANONICALIZES_TO]->(canonical)" in query
        assert "canonical.normalizedAliases = concept.normalized_aliases" in query
        assert "DELETE" not in query.upper()
        assert params["concepts"] == [
            {
                **concept,
                "normalized_preferred_label": "python",
                "normalized_aliases": ["python programming"],
            }
        ]


@pytest.mark.anyio
async def test_esco_lookup_normalizes_aliases_before_querying() -> None:
    service = Neo4jService(uri="bolt://unused", user="neo4j", password="unused")
    driver = _FakeDriver()
    service.driver = driver

    concepts = await service.get_esco_concepts_for_aliases(["  Python   Programming "])

    assert concepts == []
    assert len(driver.calls) == 1
    query, params = driver.calls[0]
    assert "concept.normalizedAliases" in query
    assert params == {"aliases": ["python programming"]}


@pytest.mark.anyio
async def test_esco_concept_upsert_preserves_existing_skill_relationships_in_neo4j() -> None:
    if not os.getenv("NEO4J_PASSWORD") or settings.neo4j_password in {
        "test-password",
        "your_neo4j_password",
    }:
        pytest.skip("Set real Neo4j credentials to run this integration test.")

    service = Neo4jService(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    suffix = uuid.uuid4().hex
    candidate_id = f"esco-schema-test-{suffix}"
    skill_name = f"esco-schema-skill-{suffix}"
    concept_uri = f"https://example.test/esco/{suffix}"

    try:
        await service.driver.verify_connectivity()
    except (Neo4jError, OSError) as exc:
        await service.close()
        pytest.skip(f"Neo4j is not reachable with current settings: {exc}")

    try:
        async with service.driver.session() as session:
            result = await session.run(
                """
                MERGE (candidate:Candidate {id: $candidate_id})
                MERGE (skill:Skill {name: $skill_name})
                MERGE (candidate)-[:HAS_SKILL]->(skill)
                """,
                candidate_id=candidate_id,
                skill_name=skill_name,
            )
            await result.consume()

        concept = {
            "uri": concept_uri,
            "preferred_label": skill_name,
            "aliases": [f"alias-{suffix}"],
            "description": "Integrationstest-Skill",
            "release": "test-release",
        }
        await service.upsert_esco_concepts([concept])
        await service.upsert_esco_concepts([concept])

        async with service.driver.session() as session:
            result = await session.run(
                """
                MATCH (candidate:Candidate {id: $candidate_id})-[:HAS_SKILL]->(skill:Skill {name: $skill_name})
                OPTIONAL MATCH (skill)-[mapping:CANONICALIZES_TO]->(concept:ESCOConcept {uri: $concept_uri})
                RETURN count(DISTINCT skill) AS skills,
                       count(mapping) AS mappings,
                       count(DISTINCT concept) AS concepts
                """,
                candidate_id=candidate_id,
                skill_name=skill_name,
                concept_uri=concept_uri,
            )
            record = await result.single()

        assert record is not None
        assert record["skills"] == 1
        assert record["mappings"] == 1
        assert record["concepts"] == 1
    finally:
        async with service.driver.session() as session:
            for query, params in [
                (
                    "MATCH (candidate:Candidate {id: $id}) DETACH DELETE candidate",
                    {"id": candidate_id},
                ),
                (
                    "MATCH (skill:Skill {name: $name}) DETACH DELETE skill",
                    {"name": skill_name},
                ),
                (
                    "MATCH (concept:ESCOConcept {uri: $uri}) DETACH DELETE concept",
                    {"uri": concept_uri},
                ),
            ]:
                result = await session.run(query, **params)
                await result.consume()
        await service.close()
