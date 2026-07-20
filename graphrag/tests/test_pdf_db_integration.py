from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from models import CandidateProfileExtraction, CandidateSkillExtraction


PDF_PATH = Path(__file__).parent / "CV 24 - Julien Fournier Lausanne, Suisse - Google Docs.pdf"


async def _is_neo4j_reachable(app_module) -> bool:
    try:
        async with app_module.db_service.driver.session() as session:
            result = await session.run("RETURN 1 AS ok")
            record = await result.single()
            return bool(record and record["ok"] == 1)
    except Exception:
        return False


@pytest.mark.anyio
async def test_ingest_candidate_pdf_real_file_and_real_neo4j(app_module, api_client, monkeypatch):
    neo4j_password = os.getenv("NEO4J_PASSWORD", "")
    if not neo4j_password or neo4j_password in {"your_neo4j_password", "test-password"}:
        pytest.skip("Set real NEO4J_PASSWORD in environment to run real DB integration test.")

    if not await _is_neo4j_reachable(app_module):
        pytest.skip("Neo4j is not reachable with current environment settings.")

    assert PDF_PATH.exists(), f"Expected PDF test fixture at {PDF_PATH}"

    candidate_id = "it-candidate-pdf-julien"
    fake_profile = CandidateProfileExtraction(
        name="Julien Fournier",
        location="Lausanne",
        experience_years=7,
        skills=[
            CandidateSkillExtraction(name="python", experience_years=7),
            CandidateSkillExtraction(name="neo4j", experience_years=2),
        ],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: candidate_id)
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", AsyncMock(return_value=fake_profile))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.11, 0.22, 0.33]))

    pdf_data = PDF_PATH.read_bytes()
    response = await api_client.post(
        "/ingest/candidate",
        files={"file": (PDF_PATH.name, pdf_data, "application/pdf")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == candidate_id

    try:
        query = """
        MATCH (c:Candidate {id: $candidate_id})
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(s:Skill)
        RETURN c.name AS name,
               c.location AS location,
               size(c.embedding) AS embedding_size,
               collect(DISTINCT s.name) AS skills
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(query, candidate_id=candidate_id)
            record = await result.single()

        assert record is not None
        assert record["name"] == "Julien Fournier"
        assert str(record["location"]).lower() == "lausanne"
        assert record["embedding_size"] == 3
        assert {skill for skill in record["skills"] if skill} >= {"python", "neo4j"}
    finally:
        cleanup_query = """
        MATCH (c:Candidate {id: $candidate_id})
        DETACH DELETE c
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(cleanup_query, candidate_id=candidate_id)
            await result.consume()
