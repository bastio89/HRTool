from __future__ import annotations

import os
from unittest.mock import AsyncMock

import pytest

from models import (
    EducationExtraction,
    IndustryExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
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
async def test_ingest_job_persists_languages_degrees_industries_and_skill_priority(
    app_module,
    api_client,
    monkeypatch,
):
    neo4j_password = os.getenv("NEO4J_PASSWORD", "")
    if not neo4j_password or neo4j_password in {"your_neo4j_password", "test-password"}:
        pytest.skip("Set real NEO4J_PASSWORD in environment to run real DB integration test.")

    if not await _is_neo4j_reachable(app_module):
        pytest.skip("Neo4j is not reachable with current environment settings.")

    job_id = "it-job-graph-bridges"
    skill_name = "python-integration-skill"
    industry_name = "aerospace-integration"

    fake_profile = JobProfileExtraction(
        title="Senior Data Engineer",
        department="Analytics",
        company="Beyond Gravity",
        recruiter_company="Beyond Gravity Recruiting",
        employer_company="Beyond Gravity AG",
        location="Zurich",
        employment_type="Vollzeit",
        required_skills=[
            JobSkillExtraction(name=skill_name, category="HardSkill", priority="Mandatory"),
            JobSkillExtraction(name="communication-integration", category="SoftSkill", priority="NiceToHave"),
        ],
        required_languages=[LanguageExtraction(name="Deutsch", level="B2")],
        required_degrees=[EducationExtraction(level="Master", field_of_study="Informatik")],
        industries=[IndustryExtraction(name=industry_name)],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: job_id)
    monkeypatch.setattr(app_module.llm_service, "parse_job_description", AsyncMock(return_value=fake_profile))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.44, 0.55, 0.66]))

    response = await api_client.post(
        "/ingest/job",
        json={
            "raw_text": (
                "Senior Data Engineer role at Beyond Gravity with mandatory Python skills, "
                "German B2, and MSc Informatik requirement."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == job_id
    assert payload["profile"]["recruiter_company"] == "Beyond Gravity Recruiting"
    assert payload["profile"]["employer_company"] == "Beyond Gravity AG"

    try:
        query = """
        MATCH (j:Job {id: $job_id})
        OPTIONAL MATCH (j)-[rs:REQUIRES_SKILL]->(s:Skill)
        OPTIONAL MATCH (j)-[rl:REQUIRES_LANGUAGE]->(l:Language)
        OPTIONAL MATCH (j)-[:REQUIRES_DEGREE]->(e:Education)
        OPTIONAL MATCH (j)-[:IN_INDUSTRY]->(i:Industry)
        RETURN j.company AS company,
             j.recruiterCompany AS recruiter_company,
             j.employerCompany AS employer_company,
               j.employmentType AS employment_type,
               collect(DISTINCT {name: s.name, priority: rs.priority}) AS skills,
               collect(DISTINCT {name: l.name, level: rl.level}) AS languages,
               collect(DISTINCT {level: e.level, field: e.fieldOfStudy}) AS degrees,
               collect(DISTINCT i.name) AS industries
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(query, job_id=job_id)
            record = await result.single()

        assert record is not None
        assert record["company"] == "Beyond Gravity"
        assert record["recruiter_company"] == "Beyond Gravity Recruiting"
        assert record["employer_company"] == "Beyond Gravity AG"
        assert record["employment_type"] == "Vollzeit"

        skills = [item for item in record["skills"] if item.get("name") is not None]
        languages = [item for item in record["languages"] if item.get("name") is not None]
        degrees = [item for item in record["degrees"] if item.get("field") is not None]
        industries = [name for name in record["industries"] if name]

        assert {item["name"] for item in skills} >= {skill_name, "communication-integration"}
        assert any(item["name"] == skill_name and item["priority"] == "Mandatory" for item in skills)
        assert any(item["name"] == "deutsch" and item["level"] == "B2" for item in languages)
        assert any(item["level"] == "Master" and item["field"] == "informatik" for item in degrees)
        assert industry_name in industries
    finally:
        cleanup_query = """
        MATCH (j:Job {id: $job_id})
        DETACH DELETE j
        """
        async with app_module.db_service.driver.session() as session:
            result = await session.run(cleanup_query, job_id=job_id)
            await result.consume()
