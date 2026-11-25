from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import psycopg
from psycopg.rows import dict_row
import pytest

from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
    MatchingCandidateInput,
    MatchingJobInput,
    VectorMatchRequest,
    LLMRerankItem,
    LLMRerankResponse,
    LinkedInProfileRequest,
    LinkedInProfileResponse,
    LinkedInPeopleSearchRequest,
)
from plugins.billing.service import BillingService
import services.linkedin_people_search as linkedin_people_search_module
from services.linkedin_people_search import LinkedInPeopleSearchService
from services.matching_orchestrator import MatchingOrchestrator
from services.postgres_store import PostgresStore
from services.skill_matching import SkillMatchingService
from services.db import Neo4jService


@pytest.mark.anyio
async def test_unfiltered_loader_keeps_alias_only_candidates_and_priorities(monkeypatch, matching_cache_doubles):
    service = Neo4jService("bolt://localhost:7687", "neo4j", "test")
    await service.driver.close()
    session = AsyncMock()
    session.__aenter__.return_value = session
    session.run.return_value = SimpleNamespace(data=AsyncMock(return_value=[
        {"id": "alias-only"}, {"id": "no-skills"},
    ]))
    service.driver = SimpleNamespace(session=lambda: session)
    jobs = [{"id": "job", "required_skills": [{"name": "Python", "priority": "NiceToHave"}]}]
    candidates = [
        {"id": "alias-only", "has_skill": [{"name": "Python programming"}]},
        {"id": "no-skills", "has_skill": []},
    ]
    monkeypatch.setattr(service, "get_jobs_for_vectormatch", AsyncMock(return_value=jobs))
    monkeypatch.setattr(service, "get_candidates_for_vectormatch", AsyncMock(return_value=candidates))
    legacy = AsyncMock(side_effect=AssertionError("Kein Namens-/Vektor-Vorfilter"))
    monkeypatch.setattr(service, "stage1_filter_candidates", legacy)
    loaded_jobs, loaded_candidates = await service.get_skill_matching_inputs(job_ids=["job"])
    service.get_candidates_for_vectormatch.assert_awaited_once_with(["alias-only", "no-skills"])
    catalog = SimpleNamespace(get_esco_concepts_for_aliases=AsyncMock(return_value=[
        {"uri": "skill:python", "preferred_label": "Python", "aliases": ["Python programming"]},
    ]))
    store = AsyncMock(spec=PostgresStore)
    llm = SimpleNamespace(
        create_embedding=AsyncMock(return_value=[1.0, 0.0]),
        rerank_candidates=AsyncMock(),
    )
    matching_cache_doubles(store, llm)
    rows, _timestamp = await MatchingOrchestrator(
        SkillMatchingService(llm, catalog),
        postgres_store=store,
    ).match_skill_matrix(
        [MatchingJobInput.model_validate(job) for job in loaded_jobs],
        [MatchingCandidateInput.model_validate(candidate) for candidate in loaded_candidates],
        model="test-embedding",
    )
    assert rows[0]["candidateId"] == "alias-only" and rows[0]["score"] == 100
    assert rows[0]["matchedSkills"][0]["match_type"] == "canonical"
    assert rows[0]["matchedSkills"][0]["priority"] == "nice_to_have"
    assert rows[1]["candidateId"] == "no-skills" and rows[1]["qualified"] is True
    legacy.assert_not_awaited()


@pytest.fixture
async def matching_store():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL fuer PostgreSQL-Integrationstests nicht gesetzt")
    store = PostgresStore(database_url)
    await store.ensure_schema()
    marker = f"matching-store-{uuid4().hex}"
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        candidate = await (await connection.execute(
            "INSERT INTO candidates (name, graph_candidate_ids) VALUES (%s, ARRAY[%s]) RETURNING id, uuid::text",
            (marker, marker),
        )).fetchone()
        other = await (await connection.execute(
            "INSERT INTO candidates (name, graph_candidate_ids) VALUES (%s, ARRAY[%s]) RETURNING id",
            (marker, marker),
        )).fetchone()
        job = await (await connection.execute(
            "INSERT INTO jobs (title, graph_job_id) VALUES (%s, %s) RETURNING id, uuid::text",
            (marker, marker),
        )).fetchone()
    try:
        yield store, candidate, job, marker
    finally:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            await connection.execute("DELETE FROM candidates WHERE id = ANY(%s)", ([candidate[0], other[0]],))
            await connection.execute("DELETE FROM jobs WHERE id = %s", (job[0],))


@pytest.mark.anyio
async def test_matching_store_resolves_only_unambiguous_stored_ids(matching_store):
    store, candidate, job, marker = matching_store
    assert await store.matching_ids_for("candidates", [str(candidate[0]), candidate[1]]) == {
        str(candidate[0]): candidate[0], candidate[1]: candidate[0],
    }
    assert await store.matching_ids_for("jobs", [job[1], marker]) == {
        job[1]: job[0], marker: job[0],
    }
    with pytest.raises(ValueError, match="nicht eindeutig"):
        await store.matching_ids_for("candidates", [marker])
    with pytest.raises(ValueError, match="fehlen"):
        await store.matching_ids_for("candidates", ["not-a-stored-id"])


@pytest.mark.anyio
async def test_matching_store_isolates_methods_timestamps_and_failed_writes(matching_store):
    store, candidate, job, _ = matching_store
    timestamp = datetime(2026, 11, 25, tzinfo=timezone.utc)
    row = {"candidateId": candidate[1], "jobId": job[1], "score": 0, "qualified": False}
    await store.record_matching_pairs("vector", [row], model="skill-model", matched_at=timestamp, engine="python")
    await store.record_matching_pairs("ai", [{**row, "score": 85}], model="ai-model", matched_at=timestamp)

    async def read():
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    "SELECT * FROM matching_pair_results WHERE candidate_id = %s AND job_id = %s ORDER BY method",
                    (candidate[0], job[0]),
                )
                return {record["method"]: record for record in await cursor.fetchall()}

    first = await read()
    assert first["vector"]["score"] == 0 and first["vector"]["qualified"] is False
    assert first["ai"]["score"] == 85 and first["ai"]["qualified"] is None
    await store.record_matching_pairs(
        "vector", [{**row, "score": 80, "qualified": True}], model="skill-model-v2",
        matched_at=timestamp + timedelta(seconds=1), engine="neo4j",
    )
    second = await read()
    assert second["ai"] == first["ai"]
    assert second["vector"]["model"] == "skill-model-v2"
    assert second["vector"]["matched_at"] == timestamp + timedelta(seconds=1)
    await store.record_matching_pairs(
        "ai", [{**row, "score": 79}], model="ai-model-v2", matched_at=timestamp + timedelta(seconds=2),
    )
    third = await read()
    assert third["vector"] == second["vector"]
    assert third["ai"]["score"] == 79 and third["ai"]["model"] == "ai-model-v2"
    await store.record_matching_pairs("ai", [{**row, "score": 1}], model="old", matched_at=timestamp)
    assert await read() == third
    with pytest.raises(psycopg.ProgrammingError):
        await store.record_matching_pairs(
            "vector", [{**row, "score": 99}, {**row, "summary": {"invalid": "SQL text"}}],
            model="failed-write", matched_at=timestamp + timedelta(seconds=3),
        )
    assert await read() == third


def _ai_orchestrator(matching_cache_doubles):
    store = AsyncMock(spec=PostgresStore)

    async def resolve_ids(table, ids):
        expected = "job-2" if table == "jobs" else "candidate-7"
        if ids != [expected]:
            raise ValueError("Gespeicherte ID fehlt")
        return {expected: 2 if table == "jobs" else 7}

    store.matching_ids_for.side_effect = resolve_ids
    store.graph_ids_for.return_value = {"7": "candidate-7"}
    store.get_job_text.return_value = {"id": 2, "title": "Engineer", "raw_text": "Jobtext"}
    store.get_candidate_text.return_value = {
        "candidate_name": "Ada", "original_text": "Profiltext",
        "profile_json": {"skills": [], "birth_date": "1980-01-01"},
    }
    llm = SimpleNamespace(
        chat_model="test-ai",
        create_embedding=AsyncMock(return_value=[1.0, 0.0]),
        rerank_candidates=AsyncMock(return_value=LLMRerankResponse(ranked_candidates=[
            LLMRerankItem(candidate_id="7", score=85, explanation="Unabhaengige AI-Gesamtbewertung."),
        ])),
    )
    skills = SkillMatchingService(
        llm, SimpleNamespace(get_esco_concepts_for_aliases=AsyncMock(return_value=[])),
    )
    matching_cache_doubles(store, llm, candidate={
        "name": "Ada", "text": {
            "original_text": "Profiltext", "profile_json": {"skills": [], "birth_date": "1980-01-01"},
        },
    }, job={"title": "Engineer", "raw_text": "Jobtext"})
    store.matching_ids_for.side_effect = resolve_ids
    return MatchingOrchestrator(skills, postgres_store=store, llm_service=llm), store, llm


@pytest.mark.anyio
async def test_orchestrator_ai_is_independent_of_missing_mandatory_skill(matching_cache_doubles):
    orchestrator, store, llm = _ai_orchestrator(matching_cache_doubles)
    skill = await orchestrator.match_skills(["Python"], [])
    assert skill.result.score == 0 and skill.result.qualified is False
    llm.create_embedding.reset_mock()

    result = await orchestrator.match_ai_pair("job-2", "candidate-7")

    assert result.score == 85 and result.qualified is None
    job, candidates = llm.rerank_candidates.await_args.args
    assert job["id"] == "2"
    assert [candidate["id"] for candidate in candidates] == ["7"]
    assert "birth_date" not in candidates[0]
    llm.create_embedding.assert_not_awaited()
    store.complete_matching_evaluation.assert_awaited_once()
    snapshot, _, _, _, persisted = store.complete_matching_evaluation.await_args.args
    assert snapshot.method == "ai"
    assert {
        **persisted, "jobId": "job-2", "candidateId": "candidate-7",
        "cacheStatus": "computed", "evaluationId": result.evaluationId,
    } == result.model_dump(mode="json")
    assert persisted["model"] == "test-ai"


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["missing-id", "missing-result", "wrong-id", "invalid-score", "ai-error", "write-error"])
async def test_orchestrator_ai_failures_never_persist_substitute_scores(failure, matching_cache_doubles):
    orchestrator, store, llm = _ai_orchestrator(matching_cache_doubles)
    candidate_id = "candidate-7"
    if failure == "missing-id":
        candidate_id = "missing"
    elif failure == "missing-result":
        llm.rerank_candidates.return_value = LLMRerankResponse()
    elif failure == "wrong-id":
        llm.rerank_candidates.return_value = LLMRerankResponse(ranked_candidates=[
            LLMRerankItem(candidate_id="unselected", score=99, explanation="Nicht ausgewaehlter Kandidat."),
        ])
    elif failure == "invalid-score":
        llm.rerank_candidates.side_effect = ValueError("Ungueltiger AI-Score")
    elif failure == "ai-error":
        llm.rerank_candidates.side_effect = RuntimeError("AI nicht erreichbar")
    else:
        store.complete_matching_evaluation.side_effect = RuntimeError("PostgreSQL-Schreibfehler")

    with pytest.raises((ValueError, RuntimeError)):
        await orchestrator.match_ai_pair("job-2", candidate_id)

    if failure != "write-error":
        store.complete_matching_evaluation.assert_not_awaited()
    if failure == "missing-id":
        llm.rerank_candidates.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()


def assert_candidate_inserted(postgres_mock, expected_payload):
    """insert_candidate erhaelt das validierte Modell, nicht das rohe Dict aus
    dem Request. Die drei Tests, die diesen Helfer nutzen, verglichen frueher
    gegen das Dict und schlugen seit der Umstellung fehl - die Werte stimmen,
    nur der Typ nicht. Geprueft wird deshalb der Inhalt."""
    postgres_mock.assert_awaited_once()
    (profile,) = postgres_mock.await_args.args
    assert postgres_mock.await_args.kwargs == {"source": "Candidate-Ingest"}
    actual = profile.model_dump() if hasattr(profile, "model_dump") else profile
    assert actual == expected_payload



@pytest.mark.anyio
async def test_health_ok(api_client):
    response = await api_client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert set(payload["ai_usage"].keys()) == {"calls", "input_tokens", "output_tokens", "total_tokens"}
    assert payload["ai_usage"]["total_tokens"] >= payload["ai_usage"]["input_tokens"]
    assert payload["ai_usage"]["total_tokens"] >= payload["ai_usage"]["output_tokens"]


@pytest.mark.anyio
async def test_external_matrix_preserves_candidate_name(monkeypatch, matching_cache_doubles):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from matching_api import create_matching_router

    _orchestrator, store, llm = _ai_orchestrator(matching_cache_doubles)
    matching_cache_doubles(store, llm)
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    app = FastAPI()
    app.include_router(create_matching_router(
        llm, SimpleNamespace(postgres_store=store, get_esco_concepts_for_aliases=AsyncMock(return_value=[])),
    ))
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/match/external/matrix",
            json={
                "jobs": [{"id": 1, "title": "Python Engineer", "required_skills": [{"name": "Python"}]}],
                "candidates": [{"id": 7, "name": "Ada Lovelace", "has_skill": [{"name": "Python"}]}],
            },
        )

    assert response.status_code == 200
    row = response.json()["matrix"][0]
    assert row["candidateName"] == "Ada Lovelace"
    assert row["summary"].startswith("Ada Lovelace ")


@pytest.mark.anyio
async def test_ingest_candidate_accepts_json(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Max Mustermann",
        location="Berlin",
        experience_years=6,
        skills=[CandidateSkillExtraction(name="python", experience_years=6)],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=42)
    graph_id_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "raw_text": (
                "Max Mustermann aus Berlin mit 6 Jahren Erfahrung in Python, FastAPI, SQL und Neo4j "
                "sucht eine Data-Engineer-Rolle."
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "cand-123"
    assert payload["message"] == "Candidate ingested successfully"
    assert payload["profile"]["name"] == "Max Mustermann"
    assert payload["persisted"] is True
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once_with(fake_profile, source="Candidate-Ingest")
    graph_id_mock.assert_awaited_once_with(42, "cand-123")
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("42")


@pytest.mark.anyio
async def test_ingest_candidate_uses_structured_profile_payload(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Max Mustermann",
        location="Berlin",
        experience_years=6,
        salary_expectation=90000,
        current_employer="ACME GmbH",
        current_position="Senior Data Engineer",
        certificates="AWS, Azure",
        drivers_license="B",
        mobility="Reisebereit",
        tags="Senior, Remote",
        notes="Structured import payload",
        skills=[CandidateSkillExtraction(name="python", experience_years=6)],
        languages=[],
        educations=[],
        industries=[],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-structured-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=43)
    graph_id_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": fake_profile.model_dump(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "cand-structured-123"
    assert payload["profile"]["name"] == "Max Mustermann"
    assert payload["persisted"] is True
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert upsert_mock.await_count == 1
    postgres_mock.assert_awaited_once_with(fake_profile, source="Candidate-Ingest")
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("43")


@pytest.mark.anyio
async def test_ingest_candidate_accepts_backend_style_string_profile_fields(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-string-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=44)
    graph_id_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "location": "Berlin",
                "experience_years": 6,
                "salary_expectation": 90000,
                "skills": "Python, Neo4j, FastAPI",
                "languages": "Deutsch (C2), Englisch (B2)",
                "educations": "Bachelor of Science, FHNW, Wirtschaftsinformatik",
                "industries": "IT, Consulting",
                "preferred_roles": "Data Engineer, Backend Engineer",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "cand-string-123"
    assert payload["profile"]["name"] == "Max Mustermann"
    assert payload["persisted"] is True
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 4
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert [skill["name"] for skill in profile_payload["skills"]] == ["Python", "Neo4j", "FastAPI"]
    assert [language["name"] for language in profile_payload["languages"]] == ["Deutsch (C2)", "Englisch (B2)"]
    assert profile_payload["preferred_roles"] == ["Data Engineer", "Backend Engineer"]
    upsert_mock.assert_awaited_once()
    assert_candidate_inserted(postgres_mock, profile_payload)
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("44")


@pytest.mark.anyio
async def test_ingest_candidate_forwards_work_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-history-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=45)
    graph_id_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "skills": ["Python"],
                "work_history": [
                    {
                        "employer": "ACME GmbH",
                        "position": "Senior Engineer",
                        "from_date": "2022-01",
                        "to_date": None,
                        "is_current": True,
                        "description": "Built data platforms",
                        "location": "Berlin",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert profile_payload["work_history"][0]["employer"] == "ACME GmbH"
    assert profile_payload["work_history"][0]["position"] == "Senior Engineer"
    upsert_mock.assert_awaited_once()
    assert_candidate_inserted(postgres_mock, profile_payload)
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("45")


@pytest.mark.anyio
async def test_ingest_candidate_forwards_education_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-education-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=46)
    graph_id_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "skills": ["Python"],
                "education_history": [
                    {
                        "institution": "FHNW",
                        "degree": "Bachelor of Science",
                        "field_of_study": "Wirtschaftsinformatik",
                        "from_date": "2018-09",
                        "to_date": "2021-06",
                        "description": "BSc thesis in data engineering",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert profile_payload["education_history"][0]["institution"] == "FHNW"
    assert profile_payload["education_history"][0]["degree"] == "Bachelor of Science"
    upsert_mock.assert_awaited_once()
    assert_candidate_inserted(postgres_mock, profile_payload)
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("46")


@pytest.mark.anyio
async def test_ingest_job_accepts_file_upload(app_module, api_client, monkeypatch):
    fake_profile = JobProfileExtraction(
        title="Senior Data Engineer",
        department="Analytics",
        location="Berlin",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="mandatory"),
            JobSkillExtraction(name="fastapi", importance="nice_to_have"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=42)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/ingest/job",
        files={"file": ("job.txt", "Senior Data Engineer in Berlin with Python and SQL", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "job-123"
    assert payload["message"] == "Job ingested successfully"
    assert payload["profile"]["title"] == "Senior Data Engineer"
    assert payload["profile"]["company"] is None
    assert payload["profile"].get("recruiter_company") is None
    assert payload["profile"].get("employer_company") is None
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 4
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    skill_payloads = [call.args[0] for call in embedding_mock.await_args_list[1:]]
    assert {payload["name"] for payload in skill_payloads} == {"python", "sql", "fastapi"}
    assert all(payload["entity"] == "skill" for payload in skill_payloads)
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()

@pytest.mark.anyio
async def test_linkedin_profile_endpoint_uses_mcp_service(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Ada Lovelace",
        location="London",
        skills=[],
        work_history=[],
        education_history=[],
    )

    fake_service = AsyncMock()
    fake_service.is_configured = True
    fake_service.extract_profile = AsyncMock(return_value=fake_profile)
    monkeypatch.setattr(app_module, "linkedin_mcp_service", fake_service)

    response = await api_client.post(
        "/linkedin/profile",
        json={"url": "https://www.linkedin.com/in/ada-lovelace/"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_url"] == "https://www.linkedin.com/in/ada-lovelace/"
    assert payload["tool_name"] == "extract_profile"
    assert payload["profile"]["name"] == "Ada Lovelace"
    fake_service.extract_profile.assert_awaited_once_with("https://www.linkedin.com/in/ada-lovelace/")


@pytest.mark.anyio
async def test_linkedin_people_search_csv_endpoint_uses_service(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module.settings, "graphrag_api_key", "test-key")
    monkeypatch.setattr(BillingService, "charge", AsyncMock(return_value={}))
    monkeypatch.setattr(LinkedInPeopleSearchService, "is_configured", property(lambda _self: True))
    export_csv = AsyncMock(return_value=("linkedin_search-010126_01.csv", "name,location\nAda,London\n"))
    monkeypatch.setattr(LinkedInPeopleSearchService, "export_csv", export_csv)

    response = await api_client.post(
        "/plugins/linkedin/people-search.csv",
        json={
            "enrichEmails": True,
            "keywords": "treasury",
            "location": "Zürich",
            "maxResults": 5,
            "mode": "public",
        },
        headers={"X-API-Key": "test-key"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "linkedin_search-010126_01.csv" in response.headers["content-disposition"]
    assert response.text == "name,location\nAda,London\n"
    export_csv.assert_awaited_once()


@pytest.mark.anyio
async def test_linkedin_people_search_uses_async_apify_client(monkeypatch, caplog):
    requests = []

    async def handle_request(request):
        requests.append(request)
        return httpx.Response(200, json=[{"name": "Ada Lovelace"}])

    real_async_client = httpx.AsyncClient

    def async_client_factory(**kwargs):
        assert kwargs["timeout"].connect == 10.0
        assert kwargs["timeout"].read == 120.0
        return real_async_client(transport=httpx.MockTransport(handle_request), **kwargs)

    monkeypatch.setattr(linkedin_people_search_module.httpx, "AsyncClient", async_client_factory)
    service = LinkedInPeopleSearchService(actor_url="https://apify.test/run-sync-get-dataset-items")
    monkeypatch.setattr(LinkedInPeopleSearchService, "_resolve_token", staticmethod(lambda: "test-token"))

    items = await service.fetch_items({"keywords": "treasury", "maxResults": 5})

    assert items == [{"name": "Ada Lovelace"}]
    assert len(requests) == 1
    assert requests[0].headers["authorization"] == "Bearer test-token"
    assert b'"keywords":"treasury"' in requests[0].content
    assert "LinkedIn people search completed" in caplog.text


@pytest.mark.anyio
async def test_vectormatch_uses_central_skill_service(app_module, api_client, monkeypatch, matching_cache_doubles):
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    monkeypatch.setattr(app_module.db_service, "get_esco_concepts_for_aliases", AsyncMock(return_value=[]))
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service)
    persist = app_module.postgres_store.complete_matching_evaluation
    monkeypatch.setattr(
        app_module.llm_service,
        "create_embedding",
        AsyncMock(side_effect=lambda payload, **_kwargs: [1.0, 0.0] if payload["name"] == "python" else [0.0, 1.0]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_jobs_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "job-1",
                "title": "Backend Engineer",
                "location": "Berlin",
                "required_skills": [
                    {"name": "python", "category": "HardSkill", "priority": "Mandatory", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "priority": "NiceToHave", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_candidates_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "cv-1",
                "name": "Max Mustermann",
                "location": "Berlin",
                "has_skill": [
                    {"name": "python", "category": "HardSkill", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )

    response = await api_client.post(
        "/match/vectormatch",
        json={"jobIds": ["job-1"], "cvIds": ["cv-1"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["type"] == "vectormatch"
    assert payload["matrix"][0]["jobId"] == "job-1"
    assert payload["matrix"][0]["candidateId"] == "cv-1"
    assert payload["matrix"][0]["score"] > 0
    assert payload["matrix"][0]["hardSkillScore"] == 1.0
    assert payload["matrix"][0]["softSkillScore"] == 1.0
    assert payload["matrix"][0]["matchedSkills"]
    assert payload["matrix"][0]["matchedSkills"][0]["jobSkillCategory"] in {"HardSkill", "SoftSkill"}
    assert payload["matrix"][0]["matchedSkills"][0]["candidateSkillCategory"] in {"HardSkill", "SoftSkill"}
    assert payload["matrix"][0]["qualified"] is True
    assert payload["pairsPersisted"] is True
    persist.assert_awaited_once()
    assert persist.await_args.args[0].method == "vector"


@pytest.mark.anyio
async def test_vectormatch_neo4j_uses_central_service_not_cypher_scores(
    app_module, api_client, monkeypatch, matching_cache_doubles,
):
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    monkeypatch.setattr(app_module.db_service, "get_esco_concepts_for_aliases", AsyncMock(return_value=[]))
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service)
    persist = app_module.postgres_store.complete_matching_evaluation
    embedding = AsyncMock(return_value=[1.0, 0.0])
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding)
    monkeypatch.setattr(
        app_module.db_service,
        "get_jobs_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "job-neo4j-1",
                "title": "Backend Engineer",
                "required_skills": [
                    {"name": "python", "category": "HardSkill", "priority": "Mandatory", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "priority": "NiceToHave", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_candidates_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "cv-neo4j-1",
                "name": "Max Mustermann",
                "has_skill": [
                    {"name": "python", "category": "HardSkill", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_vectormatch_neo4j_rows",
        AsyncMock(return_value=[
            {
                "jobId": "job-neo4j-1",
                "jobTitle": "Backend Engineer",
                "candidateId": "cv-neo4j-1",
                "candidateName": "Max Mustermann",
                "score": 92,
                "vectorScore": 0.92,
                "hardSkillScore": 0.97,
                "softSkillScore": 0.84,
                "matchedSkills": [
                    {"jobSkill": "python", "jobSkillCategory": "HardSkill", "candidateSkill": "python", "candidateSkillCategory": "HardSkill", "similarity": 0.97, "priority": "Mandatory"},
                    {"jobSkill": "communication", "jobSkillCategory": "SoftSkill", "candidateSkill": "communication", "candidateSkillCategory": "SoftSkill", "similarity": 0.84, "priority": "NiceToHave"},
                ],
            }
        ]),
    )

    response = await api_client.post(
        "/match/vectormatch_neo4j",
        json={"jobIds": ["job-neo4j-1"], "cvIds": ["cv-neo4j-1"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["type"] == "vectormatch_neo4j"
    assert payload["matrix"][0]["jobId"] == "job-neo4j-1"
    assert payload["matrix"][0]["candidateId"] == "cv-neo4j-1"
    assert payload["matrix"][0]["score"] == 100
    assert payload["matrix"][0]["vectorScore"] == 1.0
    assert payload["matrix"][0]["hardSkillScore"] == 1.0
    assert payload["matrix"][0]["softSkillScore"] == 1.0
    assert payload["matrix"][0]["matchedSkills"][0]["similarity"] == 1.0
    app_module.db_service.get_vectormatch_neo4j_rows.assert_not_awaited()
    assert all(call.kwargs == {"allow_fallback": False} for call in embedding.await_args_list)
    persist.assert_awaited_once()
    assert persist.await_args.kwargs["engine"] == "neo4j"


@pytest.mark.anyio
async def test_ki_match_pairs_uses_id_based_graph_rag_matching(
    app_module, api_client, monkeypatch, matching_cache_doubles,
):
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    fake_store = type(
        "FakeStore",
        (),
        {
            "get_job_text": AsyncMock(return_value={
                "id": 2,
                "graph_job_id": "graph-job-1",
                "title": "Data Engineer",
                "location": "Zürich",
                "type": "Vollzeit",
                "raw_text": "Data Engineer role with Python, SQL and ETL focus.",
                "description": "Data Engineer role",
                "requirements": "Python, SQL, ETL",
                "parsed_profile_json": {
                    "title": "Data Engineer",
                    "location": "Zürich",
                    "employment_type": "Vollzeit",
                },
            }),
            "get_candidate_text": AsyncMock(return_value={
                "candidate_id": "7",
                "original_text": "Ada Example has worked with Python, SQL and ETL pipelines.",
                "anonymized_text": None,
                "candidate_name": "Ada Example",
                "profile_json": {
                    "name": "Ada Example",
                    "location": "Zürich",
                    "experience": "Python, SQL, ETL",
                    "education": "BSc Informatik",
                    "skills": [{"name": "python", "category": "HardSkill"}],
                    "languages": [{"name": "de"}],
                    "desired_salary": "120000",
                    "availability": "Per sofort",
                },
            }),
        },
    )()
    fake_store.matching_ids_for = AsyncMock(side_effect=lambda table, ids: {
        value: 2 if table == "jobs" else 7 for value in ids
    })
    fake_store.graph_ids_for = AsyncMock(return_value={})
    fake_store.record_matching_pairs = AsyncMock()
    for name in ("matching_ids_for", "graph_ids_for", "record_matching_pairs", "get_job_text", "get_candidate_text"):
        monkeypatch.setattr(app_module.postgres_store, name, getattr(fake_store, name))
    monkeypatch.setattr(
        app_module.llm_service,
        "rerank_candidates",
        AsyncMock(return_value=LLMRerankResponse(ranked_candidates=[
            LLMRerankItem(candidate_id="7", score=91, explanation="Sehr guter Fit"),
        ]))
    )
    text = fake_store.get_candidate_text.return_value
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service, candidate={
        "name": text["candidate_name"],
        "text": {"original_text": text["original_text"], "profile_json": text["profile_json"]},
    }, job=fake_store.get_job_text.return_value)
    app_module.postgres_store.matching_ids_for.side_effect = fake_store.matching_ids_for.side_effect

    response = await api_client.post(
        "/match/ki_match_pairs",
        json={"pairs": [{"jobId": "job-ki-1", "cvId": "cv-ki-1"}]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["selectedCount"] == 1
    assert payload["matchedCount"] == 1
    assert payload["failedCount"] == 0
    assert payload["results"][0]["jobId"] == "job-ki-1"
    assert payload["results"][0]["candidateId"] == "cv-ki-1"
    assert payload["results"][0]["score"] == 91
    assert payload["results"][0]["summary"] == "Sehr guter Fit"
    assert payload["results"][0]["method"] == "ai"
    assert payload["pairsPersisted"] is True
    app_module.postgres_store.complete_matching_evaluation.assert_awaited_once()
    assert app_module.postgres_store.complete_matching_evaluation.await_args.args[0].method == "ai"


@pytest.mark.anyio
@pytest.mark.parametrize("scenario", ["mixed", "ai-error", "write-error", "empty"])
async def test_selected_ai_endpoint_reports_pair_errors_without_legacy_fallback(
    monkeypatch, scenario, matching_cache_doubles,
):
    from fastapi import FastAPI
    from matching_api import create_matching_router

    orchestrator, store, llm = _ai_orchestrator(matching_cache_doubles)
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    if scenario == "ai-error":
        llm.rerank_candidates.side_effect = RuntimeError("AI nicht erreichbar")
    elif scenario == "write-error":
        store.complete_matching_evaluation.side_effect = RuntimeError("Paarpersistenz fehlgeschlagen")
    app = FastAPI()
    app.include_router(create_matching_router(
        llm, SimpleNamespace(postgres_store=store, get_esco_concepts_for_aliases=AsyncMock(return_value=[])),
    ))
    pairs = [] if scenario == "empty" else [
        {"jobId": "job-2", "candidateId": "candidate-7"},
        {"jobId": "job-2", "candidateId": "missing"},
    ]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/match/ki_match_pairs", json={"pairs": pairs})
    if scenario == "empty":
        assert response.status_code == 400
        llm.rerank_candidates.assert_not_awaited()
    else:
        assert response.status_code == 200
        body = response.json()
        assert body["matchedCount"] == (1 if scenario == "mixed" else 0)
        assert body["failedCount"] == (1 if scenario == "mixed" else 2)
        assert all(failure["error"] for failure in body["failures"])
        if scenario == "mixed":
            assert body["results"][0]["score"] == 85
            assert body["results"][0]["qualified"] is None
    llm.create_embedding.assert_not_awaited()


@pytest.mark.anyio
async def test_ingest_job_profile_overrides_parsed_title(app_module, api_client, monkeypatch):
    provided_profile = JobProfileExtraction(
        title="Senior Backend Engineer",
        location="Berlin",
        employment_type="Vollzeit",
    )
    parsed_profile = JobProfileExtraction(
        title="Wrong Parsed Title",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="mandatory"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-profile-override-123")
    parse_mock = AsyncMock(return_value=parsed_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=43)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/ingest/job",
        json={
            "raw_text": "Senior Backend Engineer needs Python and SQL",
            "profile": provided_profile.model_dump(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["profile"]["title"] == "Senior Backend Engineer"
    assert payload["profile"]["location"] == "Berlin"
    assert payload["profile"]["required_skills"]
    assert any(skill["name"] == "python" for skill in payload["profile"]["required_skills"])
    parse_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_add_job_accepts_plaintext_and_persists_to_postgres_and_neo4j(app_module, api_client, monkeypatch):
    fake_profile = JobProfileExtraction(
        title="Principal Data Engineer",
        company="ACME AG",
        location="Zürich",
        employment_type="Vollzeit",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="nice_to_have"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-add-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=99)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/add/job/",
        content=b"Principal Data Engineer at ACME AG in Zurich requires Python and SQL skills.",
        headers={"content-type": "text/plain"},
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["id"] == "job-add-123"
    assert payload["profile"]["title"] == "Principal Data Engineer"
    parse_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_ingest_candidate_accepts_pdf_upload(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Lisa Beispiel",
        location="Munich",
        experience_years=8,
        skills=[CandidateSkillExtraction(name="python", experience_years=8)],
        preferred_roles=["ml engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-pdf-123")
    monkeypatch.setattr(
        app_module.pdf_service,
        "extract_text",
        lambda _: "Lisa Beispiel, 8 years experience in Python and ML engineering.",
    )
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.4, 0.5, 0.6])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()
    graph_id_mock = AsyncMock()
    # Fehlte hier als einzigem Test dieser Reihe - die Zuweisung und das
    # Patchen von insert_candidate waren beim Kopieren verlorengegangen,
    # weshalb die Zusicherung unten auf einen undefinierten Namen zugriff.
    postgres_mock = AsyncMock(return_value=43)

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)
    monkeypatch.setattr(app_module.postgres_store, "set_candidate_graph_id", graph_id_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        files={"file": ("cv.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "cand-pdf-123"
    assert payload["message"] == "Candidate ingested successfully"
    assert payload["profile"]["name"] == "Max Mustermann"
    assert payload["persisted"] is True
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once_with(fake_profile, source="Candidate-Ingest")
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("43")


@pytest.mark.anyio
async def test_delete_candidate_removes_neo4j_node(app_module, api_client, monkeypatch):
    delete_mock = AsyncMock(return_value=1)
    monkeypatch.setattr(app_module.db_service, "delete_candidate", delete_mock)

    response = await api_client.request(
        "DELETE",
        "/ingest/candidate",
        json={"candidate_id": "graph-candidate-123"},
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "neo4j_deleted": 1}
    delete_mock.assert_awaited_once_with(
        "graph-candidate-123",
        email=None,
        phone=None,
        name=None,
        location=None,
    )


@pytest.mark.anyio
async def test_ingest_candidate_pdf_parse_error_returns_400(app_module, api_client, monkeypatch):
    monkeypatch.setattr(
        app_module.pdf_service,
        "extract_text",
        lambda _: (_ for _ in ()).throw(ValueError("Could not parse uploaded PDF file.")),
    )

    response = await api_client.post(
        "/ingest/candidate",
        files={"file": ("broken.pdf", b"not-a-real-pdf", "application/pdf")},
    )

    assert response.status_code == 400
    assert "Could not parse uploaded PDF file." in response.text


@pytest.mark.anyio
async def test_ingest_job_rejects_pdf_upload(api_client):
    response = await api_client.post(
        "/ingest/job",
        files={"file": ("job.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )

    assert response.status_code == 400
    assert "PDF upload is only supported for candidate CV ingestion." in response.text


@pytest.mark.anyio
async def test_ingest_candidate_returns_400_for_missing_input(api_client):
    response = await api_client.post("/ingest/candidate")

    assert response.status_code == 400
    assert "Provide either raw_text or a non-empty file" in response.text


@pytest.mark.anyio
async def test_match_returns_404_when_job_not_found(app_module, api_client, monkeypatch, matching_cache_doubles):
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service)
    monkeypatch.setattr(app_module.db_service, "get_skill_matching_inputs", AsyncMock(return_value=([], [])))

    response = await api_client.post("/match/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.text


@pytest.mark.anyio
async def test_match_returns_empty_when_no_candidates_exist(app_module, api_client, monkeypatch, matching_cache_doubles):
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service)
    loader = AsyncMock(
        return_value=([{
            "id": "job-1",
            "title": "Data Engineer",
            "department": "Analytics",
            "location": "Berlin",
            "embedding": [0.1, 0.2],
            "required_skills": [{"name": "python", "importance": "mandatory"}],
        }], [])
    )
    monkeypatch.setattr(app_module.db_service, "get_skill_matching_inputs", loader)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    body = response.json()
    assert body.pop("statusUrl") == f"/matching/runs/{body.pop('runId')}"
    assert body == {
        "job_id": "job-1",
        "stage1_count": 0,
        "stage2_count": 0,
        "matches": [],
    }
    BillingService.charge_matching_run.assert_not_awaited()


@pytest.mark.anyio
async def test_match_limits_after_central_scoring_and_never_reranks(
    app_module, api_client, monkeypatch, matching_cache_doubles,
):
    matching_cache_doubles(app_module.postgres_store, app_module.llm_service)
    jobs = [{"id": "job-1", "title": "Engineer", "required_skills": [{"name": "Python"}]}]
    candidates = [
        {"id": f"missing-{index}", "name": f"No Skills {index}", "has_skill": []}
        for index in range(10)
    ] + [{"id": "late-alias", "name": "Ada", "has_skill": [{"name": "Coding"}]}]
    monkeypatch.setattr(app_module.db_service, "get_skill_matching_inputs", AsyncMock(return_value=(jobs, candidates)))
    monkeypatch.setattr(app_module.db_service, "get_esco_concepts_for_aliases", AsyncMock(return_value=[
        {"uri": "skill:python", "preferred_label": "Python", "aliases": ["Coding"]},
    ]))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[1.0, 0.0]))
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    legacy = AsyncMock(side_effect=AssertionError("Kein vorgelagertes Scoring"))
    monkeypatch.setattr(app_module.db_service, "stage1_filter_candidates", legacy)
    monkeypatch.setattr(app_module.db_service, "stage2_rank_candidates", legacy)
    rerank_mock = AsyncMock(side_effect=AssertionError("Kein AI-Reranking"))
    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", rerank_mock)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "job-1"
    assert payload["stage1_count"] == 11
    assert payload["stage2_count"] == 11
    assert len(payload["matches"]) == 10
    assert payload["matches"][0]["candidate_id"] == "late-alias"
    assert payload["matches"][0]["score"] == 100
    assert payload["matches"][1]["score"] == 0
    assert payload["matches"][1]["qualified"] is False
    assert payload["matches"][0]["jaccard_score"] is None
    assert payload["matches"][0]["vector_score"] is None
    assert payload["matches"][0]["combined_score"] is None
    assert app_module.postgres_store.complete_matching_evaluation.await_count == 11
    assert payload["matches"][0]["cacheStatus"] == "computed"
    repeated = await api_client.post("/match/job-1")
    assert repeated.status_code == 200
    cached = repeated.json()["matches"][0]
    assert cached["cacheStatus"] == "hit"
    assert cached["matchedAt"] == payload["matches"][0]["matchedAt"]
    assert cached["evaluationId"] == payload["matches"][0]["evaluationId"]
    assert app_module.postgres_store.complete_matching_evaluation.await_count == 11
    BillingService.charge_matching_run.assert_awaited_once()
    assert BillingService.charge_matching_run.await_args.args[1:] == ("-1.00", "AI_MATCH")
    BillingService.charge.assert_not_awaited()
    rerank_mock.assert_not_awaited()
    legacy.assert_not_awaited()
