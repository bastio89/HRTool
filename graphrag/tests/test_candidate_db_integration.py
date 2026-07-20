from __future__ import annotations

import os
from unittest.mock import AsyncMock

import pytest

from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    EducationExtraction,
    IndustryExtraction,
    LanguageExtraction,
)


async def _is_neo4j_reachable(app_module) -> bool:
    try:
        async with app_module.db_service.driver.session() as session:
            result = await session.run("RETURN 1 AS ok")
            record = await result.single()
            return bool(record and record["ok"] == 1)
    except Exception:
        return False


@pytest.mark.anyio
async def test_ingest_candidate_persists_languages_degrees_industries_and_salary(
    app_module,
    api_client,
    monkeypatch,
):
    neo4j_password = os.getenv("NEO4J_PASSWORD", "")
    if not neo4j_password or neo4j_password in {"your_neo4j_password", "test-password"}:
        pytest.skip("Set real NEO4J_PASSWORD in environment to run real DB integration test.")

    if not await _is_neo4j_reachable(app_module):
        pytest.skip("Neo4j is not reachable with current environment settings.")

    candidate_id = "it-candidate-graph-bridges"
    skill_name = "python-integration-candidate"
    industry_name = "automotive-integration"

    fake_profile = CandidateProfileExtraction(
        name="Lina Beispiel",
        location="Munich",
        experience_years=6,
        salary_expectation=98000,
        skills=[
            CandidateSkillExtraction(
                name=skill_name,
                category="HardSkill",
                level="Expert",
                experience_years=6,
            ),
        ],
        languages=[LanguageExtraction(name="Deutsch", level="C1")],
        educations=[EducationExtraction(level="Master", field_of_study="Informatik")],
        industries=[IndustryExtraction(name=industry_name)],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: candidate_id)
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", AsyncMock(return_value=fake_profile))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.12, 0.23, 0.34]))

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "raw_text": (
                "Data engineer profile with Python, German C1, and MSc Informatik in automotive context."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == candidate_id

    try:
        query = """
        MATCH (c:Candidate {id: $candidate_id})
        OPTIONAL MATCH (c)-[hs:HAS_SKILL]->(s:Skill)
        OPTIONAL MATCH (c)-[sp:SPEAKS]->(l:Language)
        OPTIONAL MATCH (c)-[:HAS_DEGREE]->(e:Education)
        OPTIONAL MATCH (c)-[:HAS_INDUSTRY]->(i:Industry)
        RETURN c.salaryExpectation AS salary_expectation,
               c.yearsOfExperience AS years_of_experience,
               collect(DISTINCT {name: s.name, level: hs.level, years: hs.yearsOfExperience}) AS skills,
               collect(DISTINCT {name: l.name, level: sp.level}) AS languages,
               collect(DISTINCT {level: e.level, field: e.fieldOfStudy}) AS degrees,
               collect(DISTINCT i.name) AS industries
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(query, candidate_id=candidate_id)
            record = await result.single()

        assert record is not None
        assert record["salary_expectation"] == 98000
        assert record["years_of_experience"] == 6

        skills = [item for item in record["skills"] if item.get("name") is not None]
        languages = [item for item in record["languages"] if item.get("name") is not None]
        degrees = [item for item in record["degrees"] if item.get("field") is not None]
        industries = [name for name in record["industries"] if name]

        assert any(
            item["name"] == skill_name
            and item["level"] == "Expert"
            and item["years"] == 6
            for item in skills
        )
        assert any(item["name"] == "deutsch" and item["level"] == "C1" for item in languages)
        assert any(item["level"] == "Master" and item["field"] == "informatik" for item in degrees)
        assert industry_name in industries
    finally:
        cleanup_query = """
        MATCH (c:Candidate {id: $candidate_id})
        DETACH DELETE c
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(cleanup_query, candidate_id=candidate_id)
            await result.consume()
