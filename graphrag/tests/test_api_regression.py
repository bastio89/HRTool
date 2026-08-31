from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from pypdf import PdfReader

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
    assert response.json()["status"] == "ok"
    assert response.json()["ai_usage"] == {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
    }


@pytest.mark.anyio
async def test_health_exposes_ai_usage_metrics(app_module, api_client, monkeypatch):
    monkeypatch.setattr(
        app_module.llm_service,
        "get_usage_metrics",
        lambda: {"calls": 12, "input_tokens": 3456, "output_tokens": 789, "total_tokens": 4245},
    )

    response = await api_client.get("/health")

    assert response.status_code == 200
    assert response.json()["ai_usage"] == {
        "calls": 12,
        "input_tokens": 3456,
        "output_tokens": 789,
        "total_tokens": 4245,
    }


@pytest.mark.anyio
async def test_parse_job_description_falls_back_when_no_json_is_returned(app_module, monkeypatch):
    async def fake_generate_json(*args, **kwargs):
        return None

    monkeypatch.setattr(app_module.llm_service, "_generate_json", fake_generate_json)

    profile = await app_module.llm_service.parse_job_description(
        "Senior Data Engineer with Python, SQL and Neo4j experience."
    )

    assert profile.title == "Senior Data Engineer"
    assert {skill.name for skill in profile.required_skills} >= {"Python", "SQL", "Neo4j"}
    assert all(skill.priority == "Mandatory" for skill in profile.required_skills)
    assert profile.about_us is None
    assert profile.description == "Senior Data Engineer with Python, SQL and Neo4j experience."
    assert profile.requirements is None
    assert profile.benefits is None


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

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": fake_profile.model_dump(),
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-structured-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert upsert_mock.await_count == 1


@pytest.mark.anyio
async def test_ingest_candidate_accepts_backend_style_string_profile_fields(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-string-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

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
    assert response.json() == {
        "id": "cand-string-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 4
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert [skill["name"] for skill in profile_payload["skills"]] == ["Python", "Neo4j", "FastAPI"]
    assert [language["name"] for language in profile_payload["languages"]] == ["Deutsch (C2)", "Englisch (B2)"]
    assert profile_payload["preferred_roles"] == ["Data Engineer", "Backend Engineer"]
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_ingest_candidate_forwards_work_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-history-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

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


@pytest.mark.anyio
async def test_parse_candidate_cv_recovers_meier_work_history_from_pdf_text(app_module, monkeypatch):
    fixture_path = Path(__file__).parent / "Meier-Werner-(51)-Senior_.NET_Core_Developer.pdf"
    raw_text = "\n".join(page.extract_text() or "" for page in PdfReader(str(fixture_path)).pages)

    async def fake_generate_json(*args, **kwargs):
        return {
            "name": "Werner Meier",
            "location": "Frauenfeld, Schweiz",
            "experience": "Technologieorientierter und analytisch starker IT-Spezialist.",
            "education": "Master of Science in Computer Science, ETH Zürich",
            "skills": ["C#", ".NET Core", "Azure"],
            "work_history": [],
            "preferred_roles": ["Senior .NET Core Developer"],
        }

    monkeypatch.setattr(app_module.llm_service, "_generate_json", fake_generate_json)

    profile = await app_module.llm_service.parse_candidate_cv(raw_text)

    assert len(profile.work_history) == 2
    assert profile.work_history[0].position == "Senior IT Specialist"
    assert profile.work_history[0].employer == "Swisscom AG"
    assert profile.work_history[0].location == "Zürich"
    assert profile.work_history[1].position == "Software Engineer"
    assert profile.work_history[1].employer == "Swiss Re"


@pytest.mark.anyio
async def test_parse_candidate_cv_accepts_common_llm_field_variants(app_module, monkeypatch):
    async def fake_generate_json(*args, **kwargs):
        return {
            "name": "Hans Burger",
            "location": "Zürich",
            "languages": [
                {"language": "Deutsch", "proficiency": "Muttersprache"},
                {"language": "Englisch", "proficiency": "Verhandlungssicher (C2)"},
            ],
            "educations": [
                {"institution": "ETH Zürich", "degree": "MSc Computer Science", "start_date": "2012", "end_date": "2015"},
            ],
            "industries": ["Telecommunications", "Insurance/Reinsurance", "IT Consulting"],
            "work_history": [
                {"company": "Swisscom AG", "role": "Senior IT Specialist", "start_date": "2015", "end_date": "2019", "current": False},
            ],
            "education_history": [
                {"school": "ETH Zürich", "degree": "MSc", "subject": "Computer Science", "start": "2012", "end": "2015"},
            ],
        }

    monkeypatch.setattr(app_module.llm_service, "_generate_json", fake_generate_json)

    profile = await app_module.llm_service.parse_candidate_cv("Hans Burger CV text")

    assert [language.name for language in profile.languages] == ["Deutsch", "Englisch"]
    assert [language.level for language in profile.languages] == ["Muttersprache", "Verhandlungssicher (C2)"]
    assert profile.educations[0].level == "MSc Computer Science"
    assert profile.educations[0].field_of_study == "ETH Zürich"
    assert [industry.name for industry in profile.industries] == ["Telecommunications", "Insurance/Reinsurance", "IT Consulting"]
    assert profile.work_history[0].employer == "Swisscom AG"
    assert profile.work_history[0].position == "Senior IT Specialist"
    assert profile.education_history[0].institution == "ETH Zürich"
    assert profile.education_history[0].degree == "MSc"


@pytest.mark.anyio
async def test_ingest_candidate_forwards_education_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-education-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)

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


@pytest.mark.anyio
async def test_external_match_run_uses_graph_rag(app_module, api_client, monkeypatch):
    response = await api_client.post(
        "/match/external/run",
        json={
            "job": {
                "id": "job-1",
                "title": "Data Engineer",
                "description": "Build Python FastAPI data platforms",
            },
            "candidates": [
                {"id": "cand-1", "name": "Alice", "skills": ["Python", "FastAPI"]},
                {"id": "cand-2", "name": "Bob", "skills": ["SQL"]},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["candidateId"] for item in payload["results"]] == ["cand-1", "cand-2"]
    assert payload["results"][0]["score"] > payload["results"][1]["score"]
    assert payload["results"][0]["strengths"]


@pytest.mark.anyio
async def test_external_match_matrix_uses_graph_rag(app_module, api_client, monkeypatch):
    response = await api_client.post(
        "/match/external/matrix",
        json={
            "mode": "all_jobs_all_candidates",
            "jobs": [
                {"id": "job-1", "title": "Data Engineer", "description": "Build Python data platforms"},
                {"id": "job-2", "title": "Backend Engineer", "description": "Build Java APIs"},
            ],
            "candidates": [
                {"id": "cand-1", "name": "Alice", "skills": ["Python"]},
                {"id": "cand-2", "name": "Bob", "skills": ["Java"]},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "matrix"
    assert payload["matrix"][0]["jobId"] in {"job-1", "job-2"}
    assert payload["jobsRanked"][0]["results"]
    assert [item["jobId"] for item in payload["jobsRanked"]] == ["job-1", "job-2"]
    assert payload["candidatesRanked"][0]["results"]


@pytest.mark.anyio
async def test_external_match_matrix_accepts_numeric_ids(app_module, api_client, monkeypatch):
    response = await api_client.post(
        "/match/external/matrix",
        json={
            "mode": "all_jobs_all_candidates",
            "jobs": [
                {"id": 10, "title": "Data Engineer", "description": "Build Python data platforms"},
                {"id": 11, "title": "Backend Engineer", "description": "Build Java APIs"},
            ],
            "candidates": [
                {"id": 1, "name": "Alice", "skills": ["Python"]},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["matrix"][0]["jobId"] == "10"
    assert payload["matrix"][0]["candidateId"] == "1"


@pytest.mark.anyio
async def test_external_match_run_accepts_numeric_candidate_fields(app_module, api_client, monkeypatch):
    response = await api_client.post(
        "/match/external/run",
        json={
            "job": {"id": 10, "title": "Data Engineer", "description": "Build Python data platforms"},
            "candidates": [
                {"id": 1, "name": "Alice", "experience": 8, "desired_salary": 90000, "availability": 17},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"][0]["candidateId"] == "1"
