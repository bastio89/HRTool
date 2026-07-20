from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
    LLMRerankItem,
    LLMRerankResponse,
    Stage1Candidate,
    Stage2Candidate,
)


@pytest.mark.anyio
async def test_health_ok(api_client):
    response = await api_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

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
    assert response.json() == {
        "id": "cand-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()


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
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
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

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

    response = await api_client.post(
        "/ingest/candidate",
        files={"file": ("cv.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-pdf-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()


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
async def test_match_returns_404_when_job_not_found(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)

    response = await api_client.post("/match/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.text


@pytest.mark.anyio
async def test_match_returns_empty_when_stage1_has_no_candidates(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(
        return_value={
            "id": "job-1",
            "title": "Data Engineer",
            "department": "Analytics",
            "location": "Berlin",
            "embedding": [0.1, 0.2],
            "required_skills": [{"name": "python", "importance": "mandatory"}],
        }
    )
    stage1_mock = AsyncMock(return_value=[])

    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)
    monkeypatch.setattr(app_module.db_service, "stage1_filter_candidates", stage1_mock)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    assert response.json() == {
        "job_id": "job-1",
        "stage1_count": 0,
        "stage2_count": 0,
        "matches": [],
    }


@pytest.mark.anyio
async def test_match_successful_rerank_and_sorting(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(
        return_value={
            "id": "job-1",
            "title": "Data Engineer",
            "department": "Analytics",
            "location": "Berlin",
            "embedding": [0.1, 0.2],
            "required_skills": [
                {"name": "python", "importance": "mandatory"},
                {"name": "sql", "importance": "mandatory"},
            ],
        }
    )
    stage1_mock = AsyncMock(
        return_value=[
            Stage1Candidate(id="cand-a", mandatory_overlap=2, role_overlap=1, location_match=True),
            Stage1Candidate(id="cand-b", mandatory_overlap=1, role_overlap=0, location_match=False),
        ]
    )
    stage2_mock = AsyncMock(
        return_value=[
            Stage2Candidate(
                id="cand-a",
                name="Alice",
                location="Berlin",
                experience_years=7,
                skills=["python", "sql"],
                preferred_roles=["data engineer"],
                vector_score=0.91,
                jaccard_score=1.0,
                combined_score=0.937,
            ),
            Stage2Candidate(
                id="cand-b",
                name="Bob",
                location="Hamburg",
                experience_years=5,
                skills=["python"],
                preferred_roles=["backend engineer"],
                vector_score=0.82,
                jaccard_score=0.5,
                combined_score=0.724,
            ),
        ]
    )
    rerank_mock = AsyncMock(
        return_value=LLMRerankResponse(
            ranked_candidates=[
                LLMRerankItem(
                    candidate_id="cand-b",
                    score=82,
                    explanation="Strong Python background and relevant backend work. Needs ramp-up on SQL depth.",
                ),
                LLMRerankItem(
                    candidate_id="cand-a",
                    score=94,
                    explanation="Excellent overlap with required skills and domain context. Location and role fit are strong.",
                ),
            ]
        )
    )

    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)
    monkeypatch.setattr(app_module.db_service, "stage1_filter_candidates", stage1_mock)
    monkeypatch.setattr(app_module.db_service, "stage2_rank_candidates", stage2_mock)
    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", rerank_mock)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "job-1"
    assert payload["stage1_count"] == 2
    assert payload["stage2_count"] == 2
    assert [item["candidate_id"] for item in payload["matches"]] == ["cand-a", "cand-b"]
    assert payload["matches"][0]["score"] == 94
    assert payload["matches"][1]["score"] == 82
    rerank_mock.assert_awaited_once()
