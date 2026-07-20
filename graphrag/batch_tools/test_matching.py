from __future__ import annotations

import importlib
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from config import settings
from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
    LLMRerankItem,
    LLMRerankResponse,
)


_REAL_PASSWORDS = {"your_neo4j_password", "test-password"}


def _require_real_neo4j_credentials() -> None:
    uri = settings.neo4j_uri
    user = settings.neo4j_user
    password = settings.neo4j_password
    if not uri or not user or not password or password in _REAL_PASSWORDS:
        pytest.skip("Set real Neo4j credentials to run the matching integration suite.")


@pytest.fixture
def app_module():
    _require_real_neo4j_credentials()
    import main

    return importlib.reload(main)


@pytest_asyncio.fixture
async def api_client(app_module):
    transport = ASGITransport(app=app_module.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _neo4j_reachable(app_module) -> bool:
    try:
        async with app_module.db_service.driver.session() as session:
            result = await session.run("RETURN 1 AS ok")
            record = await result.single()
            return bool(record and record["ok"] == 1)
    except Exception:
        return False


async def _find_matchable_job(app_module, max_jobs: int = 25):
    query = """
    MATCH (j:Job)
    RETURN j.id AS id
    ORDER BY j.id
    LIMIT $limit
    """
    async with app_module.db_service.driver.session() as session:
        result = await session.run(query, limit=max_jobs)
        rows = await result.data()

    for row in rows:
        job_id = row["id"]
        job_profile = await app_module.db_service.get_job_profile(job_id)
        if not job_profile:
            continue

        stage1 = await app_module.db_service.stage1_filter_candidates(job_id=job_id, limit=10)
        if stage1:
            return job_id, job_profile, stage1

    pytest.skip(f"No job with stage1 matches found in the first {max_jobs} jobs.")


async def _delete_test_nodes(app_module, *, job_id: str, candidate_id: str) -> None:
    query = """
    MATCH (c:Candidate {id: $candidate_id})
    DETACH DELETE c
    WITH 1 AS _
    MATCH (j:Job {id: $job_id})
    DETACH DELETE j
    """
    async with app_module.db_service.driver.session() as session:
        result = await session.run(query, job_id=job_id, candidate_id=candidate_id)
        await result.consume()


@pytest.mark.anyio
async def test_match_api_returns_ranked_matches_from_existing_api(app_module, api_client, monkeypatch):
    if not await _neo4j_reachable(app_module):
        pytest.skip("Neo4j is not reachable with the current environment settings.")

    job_id = "job-api-match-existing-api"
    candidate_ids = ["cand-api-match-existing-api-a", "cand-api-match-existing-api-b"]
    unique_skill = "api-match-existing-skill"
    unique_location = "api-match-existing-location"
    full_embedding = [1.0] + [0.0] * (app_module.llm_service.embedding_dimensions - 1)

    job_profile = JobProfileExtraction(
        title="Data Engineer Existing API Fixture",
        department="Analytics",
        company="Test Corp",
        location=unique_location,
        required_skills=[JobSkillExtraction(name=unique_skill, importance="mandatory")],
    )
    candidate_profiles = [
        CandidateProfileExtraction(
            name="API Fixture Candidate A",
            location=unique_location,
            experience_years=7,
            skills=[CandidateSkillExtraction(name=unique_skill, experience_years=7)],
            preferred_roles=["data engineer"],
        ),
        CandidateProfileExtraction(
            name="API Fixture Candidate B",
            location=unique_location,
            experience_years=5,
            skills=[CandidateSkillExtraction(name=unique_skill, experience_years=5)],
            preferred_roles=["data engineer"],
        ),
    ]

    parse_job_mock = AsyncMock(return_value=job_profile)
    parse_candidate_mock = AsyncMock(side_effect=candidate_profiles)
    embedding_mock = AsyncMock(return_value=full_embedding)

    monkeypatch.setattr(app_module, "uuid4", lambda: job_id)
    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_job_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)

    job_response = await api_client.post(
        "/ingest/job",
        json={
            "raw_text": "Data Engineer Existing API Fixture role with the api-match-existing-skill skill.",
        },
    )
    assert job_response.status_code == 200, job_response.text
    assert job_response.json()["id"] == job_id

    candidate_texts = [
        "API Fixture Candidate A with the api-match-existing-skill skill and matching background.",
        "API Fixture Candidate B with the api-match-existing-skill skill and matching background.",
    ]
    for candidate_id, candidate_text in zip(candidate_ids, candidate_texts, strict=True):
        monkeypatch.setattr(app_module, "uuid4", lambda candidate_id=candidate_id: candidate_id)
        monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_candidate_mock)

        candidate_response = await api_client.post(
            "/ingest/candidate",
            json={"raw_text": candidate_text},
        )
        assert candidate_response.status_code == 200, candidate_response.text
        assert candidate_response.json()["id"] == candidate_id

    async def fake_rerank_candidates(*, job_profile, candidates):
        return LLMRerankResponse(
            ranked_candidates=[
                LLMRerankItem(
                    candidate_id=item["id"],
                    score=90 - index,
                    explanation=f"Candidate {item['id']} looks relevant.",
                )
                for index, item in enumerate(candidates)
            ]
        )

    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", fake_rerank_candidates)

    try:
        response = await api_client.post(f"/match/{job_id}")

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["job_id"] == job_id
        assert payload["stage1_count"] == 2
        assert payload["stage2_count"] == 2
        assert {match["candidate_id"] for match in payload["matches"]} == set(candidate_ids)
        assert [match["score"] for match in payload["matches"]] == [90, 89]
        assert payload["matches"] == sorted(payload["matches"], key=lambda item: item["score"], reverse=True)
        for match in payload["matches"]:
            assert 1 <= match["score"] <= 100
            assert match["explanation"]
            assert match["profile"]["skills"] == [unique_skill]
    finally:
        await _delete_test_nodes(app_module, job_id=job_id, candidate_id=candidate_ids[0])
        await _delete_test_nodes(app_module, job_id=job_id, candidate_id=candidate_ids[1])


@pytest.mark.anyio
async def test_match_api_with_api_ingested_fixture_data(app_module, api_client, monkeypatch):
    job_id = "job-api-match-fixture"
    candidate_id = "cand-api-match-fixture"
    unique_skill = "api-match-skill-fixture"
    unique_location = "api-match-location-fixture"
    full_embedding = [1.0] + [0.0] * (app_module.llm_service.embedding_dimensions - 1)

    job_profile = JobProfileExtraction(
        title="Data Engineer API Fixture",
        department="Analytics",
        company="Test Corp",
        location=unique_location,
        required_skills=[JobSkillExtraction(name=unique_skill, importance="mandatory")],
    )
    candidate_profile = CandidateProfileExtraction(
        name="API Fixture Candidate",
        location=unique_location,
        experience_years=7,
        skills=[CandidateSkillExtraction(name=unique_skill, experience_years=7)],
        preferred_roles=["data engineer"],
    )

    parse_job_mock = AsyncMock(return_value=job_profile)
    parse_candidate_mock = AsyncMock(return_value=candidate_profile)
    embedding_mock = AsyncMock(return_value=full_embedding)

    monkeypatch.setattr(app_module, "uuid4", lambda: job_id)
    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_job_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)

    job_response = await api_client.post(
        "/ingest/job",
        json={
            "raw_text": "Data Engineer API Fixture role with the api-match-skill-fixture skill.",
        },
    )
    assert job_response.status_code == 200, job_response.text
    assert job_response.json()["id"] == job_id

    monkeypatch.setattr(app_module, "uuid4", lambda: candidate_id)
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_candidate_mock)

    candidate_response = await api_client.post(
        "/ingest/candidate",
        json={
            "raw_text": "API Fixture Candidate with the api-match-skill-fixture skill and matching background.",
        },
    )
    assert candidate_response.status_code == 200, candidate_response.text
    assert candidate_response.json()["id"] == candidate_id

    async def fake_rerank_candidates(*, job_profile, candidates):
        return LLMRerankResponse(
            ranked_candidates=[
                LLMRerankItem(
                    candidate_id=item["id"],
                    score=100,
                    explanation="Deterministic API fixture match.",
                )
                for item in candidates
            ]
        )

    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", fake_rerank_candidates)

    try:
        match_response = await api_client.post(f"/match/{job_id}")

        assert match_response.status_code == 200, match_response.text
        payload = match_response.json()
        assert payload["job_id"] == job_id
        assert payload["stage1_count"] == 1
        assert payload["stage2_count"] == 1
        assert len(payload["matches"]) == 1

        match = payload["matches"][0]
        assert match["candidate_id"] == candidate_id
        assert match["score"] == 100
        assert match["explanation"] == "Deterministic API fixture match."
        assert match["profile"]["skills"] == [unique_skill]
    finally:
        await _delete_test_nodes(app_module, job_id=job_id, candidate_id=candidate_id)